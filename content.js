// Twitter信息抓取内容脚本
class TwitterScraper {
  constructor() {
    this.tweets = [];
    this.isRunning = false;
    this.tweetIds = new Set(); // 用于快速查重
  }

  // 自动点击"显示更多"按钮展开推文内容
  expandTweetContent(tweetElement) {
    try {
      // 查找主推文内的"显示更多"按钮
      const showMoreBtn = tweetElement.querySelector(
        '[data-testid="tweet-text-show-more-link"]'
      );
      if (
        showMoreBtn &&
        showMoreBtn.offsetParent !== null &&
        showMoreBtn.tagName.toLowerCase() !== "a" &&
        showMoreBtn.parentElement?.tagName.toLowerCase() !== "a" &&
        !showMoreBtn.closest('[role="link"]')
      ) {
        // 检查按钮是否在引用推文内
        const quoteTweet = showMoreBtn.closest('[data-testid="quoteTweet"]');
        if (!quoteTweet) {
          console.log("点击显示更多按钮");
          showMoreBtn.click();
          return new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      // 在整个推文元素内查找"显示更多"按钮，但排除引用推文
      const allButtons = tweetElement.querySelectorAll(
        'div[role="button"], span[role="button"], span'
      );
      for (const btn of allButtons) {
        // 确保按钮不在引用推文内
        const quoteTweet = btn.closest('[data-testid="quoteTweet"]');
        if (quoteTweet) continue;

        const text = btn.textContent?.trim();
        if (
          (text === "显示更多" ||
            text === "Show more" ||
            text === "…显示更多" ||
            text === "Show this thread") &&
          btn.tagName.toLowerCase() !== "a" &&
          !btn.closest('[role="link"]')
        ) {
          console.log(`点击显示更多文本按钮: ${text}`);
          btn.click();
          return new Promise((resolve) => setTimeout(resolve, 200));
        }
      }

      return Promise.resolve();
    } catch (error) {
      console.error("展开推文内容时出错:", error);
      return Promise.resolve();
    }
  }

  // 提取推文信息
  async extractTweetData(tweetElement) {
    try {
      // 先尝试展开推文内容
      await this.expandTweetContent(tweetElement);

      const author =
        tweetElement
          .querySelector('[data-testid="User-Name"]')
          ?.textContent?.trim() || "";
      const username =
        tweetElement
          .querySelector('[data-testid="User-Name"] a')
          ?.getAttribute("href")
          ?.replace("/", "") || "";

      // 获取完整推文内容，包括展开后的内容
      let content = "";
      const tweetTextElement = tweetElement.querySelector(
        '[data-testid="tweetText"]'
      );
      if (tweetTextElement) {
        // 获取所有文本内容，包括展开后的
        content = tweetTextElement.textContent?.trim() || "";

        // 如果内容被截断，尝试获取完整内容
        if (content.endsWith("…") || content.includes("…")) {
          // 再次尝试展开
          await this.expandTweetContent(tweetElement);
          content = tweetTextElement.textContent?.trim() || "";
        }
      }

      const time =
        tweetElement.querySelector("time")?.getAttribute("datetime") || "";
      const likes =
        tweetElement
          .querySelector('[data-testid="like"]')
          ?.textContent?.trim() || "0";
      const retweets =
        tweetElement
          .querySelector('[data-testid="retweet"]')
          ?.textContent?.trim() || "0";
      const replies =
        tweetElement
          .querySelector('[data-testid="reply"]')
          ?.textContent?.trim() || "0";

      // 提取图片链接
      const images = Array.from(
        tweetElement.querySelectorAll('img[src*="pbs.twimg.com"]')
      ).map((img) => img.src);

      // 提取链接
      const links = Array.from(
        tweetElement.querySelectorAll('a[href*="t.co"]')
      ).map((link) => link.href);

      // 生成唯一ID用于去重
      const tweetId = this.generateTweetId(author, content, time);

      return {
        id: tweetId,
        author,
        username,
        content,
        time,
        likes,
        retweets,
        replies,
        images,
        links,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("提取推文数据时出错:", error);
      return null;
    }
  }

  // 生成推文唯一ID
  generateTweetId(author, content, time) {
    // 使用作者、内容和时间生成唯一标识
    const data = `${author}|${content}|${time}`;
    return this.simpleHash(data);
  }

  // 简单哈希函数
  simpleHash(str) {
    let hash = 0;
    if (str.length === 0) return hash;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash).toString(36);
  }

  // 检查推文是否超过时间限制（已移除限制）
  isTweetTooOld(tweetTime) {
    return false; // 不再检查时间限制
  }

  // 检查推文是否已存在
  isDuplicateTweet(tweetId) {
    return this.tweetIds.has(tweetId);
  }


  // 添加推文到集合
  async addTweet(tweet) {
    if (!this.isDuplicateTweet(tweet.id)) {
      this.tweets.push(tweet);
      this.tweetIds.add(tweet.id);
      return true;
    }
    return false;
  }

  // 检查是否为主推文（非回复/评论）
  isMainTweet(tweetElement) {
    // 检查是否有回复标识
    const replyIndicator = tweetElement.querySelector('[data-testid="reply"]');
    const parentReply = tweetElement
      .closest('[data-testid="tweet"]')
      ?.querySelector('svg[data-testid="reply"]');

    // 检查推文结构，主推文通常在时间线中独立存在
    const isInTimeline =
      tweetElement.closest('section[aria-labelledby*="accessible-list"]') ||
      tweetElement.closest('[data-testid="primaryColumn"]');

    // 检查URL结构，避免抓取推文详情页面的回复
    const currentUrl = window.location.href;
    const isDetailPage = /\/status\/\d+/.test(currentUrl);

    // 如果在详情页面，只抓取第一条推文（原推文）
    if (isDetailPage) {
      const allTweets = document.querySelectorAll('[data-testid="tweet"]');
      return tweetElement === allTweets[0];
    }

    // 检查是否有"回复给"文本
    const hasReplyText =
      tweetElement.textContent.includes("回复给") ||
      tweetElement.textContent.includes("Replying to") ||
      tweetElement.querySelector('[data-testid="socialContext"]');

    return isInTimeline && !hasReplyText;
  }

  // 获取页面上的所有主推文
  async scrapeCurrentTweets() {
    const tweetElements = document.querySelectorAll('[data-testid="tweet"]');
    const scrapedTweets = [];

    for (const element of tweetElements) {
      // 只处理主推文，跳过回复和评论
      if (this.isMainTweet(element)) {
        const tweetData = await this.extractTweetData(element);
        if (
          tweetData &&
          tweetData.content &&
          !this.isDuplicateTweet(tweetData.id)
        ) {
          const isAdded = await this.addTweet(tweetData);
          if (isAdded) {
            scrapedTweets.push(tweetData);
          }
        }
      }
    }

    return scrapedTweets;
  }


  // 检查是否在正确的页面
  isOnCorrectPage() {
    const currentUrl = window.location.href;
    return currentUrl.includes("x.com") || currentUrl.includes("twitter.com");
  }

  // 检查是否在时间线页面（而不是推文详情页）
  isOnTimelinePage() {
    const currentUrl = window.location.href;
    // 时间线页面的URL模式：x.com/home, x.com/following 等
    const timelinePatterns = [
      "/home",
      "/following",
      "x.com/$",
      "twitter.com/$",
    ];

    // 不应该在推文详情页（包含 /status/ 的URL）
    if (currentUrl.includes("/status/")) {
      return false;
    }

    return timelinePatterns.some((pattern) => {
      if (pattern.endsWith("$")) {
        return currentUrl.match(new RegExp(pattern));
      }
      return currentUrl.includes(pattern);
    });
  }

  // 阻止推文点击跳转到详情页
  preventTweetClicks() {
    document.addEventListener(
      "click",
      (event) => {
        if (!this.isRunning) return;

        // 查找是否点击的是推文区域
        const tweetElement = event.target.closest('[data-testid="tweet"]');
        if (tweetElement) {
          // 允许点击特定的按钮（点赞、转发、回复等）
          const allowedElements = [
            '[data-testid="like"]',
            '[data-testid="retweet"]',
            '[data-testid="reply"]',
            '[data-testid="bookmark"]',
            '[data-testid="share"]',
            "button",
            'a[href*="t.co"]', // 外部链接
          ];

          let isAllowedClick = allowedElements.some((selector) =>
            event.target.closest(selector)
          );

          // 特殊处理展开按钮 - 只允许主推文的展开按钮
          const showMoreBtn = event.target.closest(
            '[data-testid="tweet-text-show-more-link"]'
          );
          if (showMoreBtn) {
            // 检查是否在引用推文内
            const quoteTweet = showMoreBtn.closest(
              '[data-testid="quoteTweet"]'
            );
            if (!quoteTweet) {
              isAllowedClick = true; // 允许主推文的展开按钮
            }
          }

          // 检查是否是主推文区域的展开文本按钮
          if (!isAllowedClick) {
            const text = event.target.textContent?.trim();
            if (
              text === "显示更多" ||
              text === "Show more" ||
              text === "…显示更多"
            ) {
              const quoteTweet = event.target.closest(
                '[data-testid="quoteTweet"]'
              );
              if (!quoteTweet) {
                isAllowedClick = true; // 允许主推文的文本展开按钮
              }
            }
          }

          // 如果不是允许的点击，阻止默认行为
          if (!isAllowedClick) {
            event.preventDefault();
            event.stopPropagation();
            console.log("阻止推文跳转");
          }
        }
      },
      true
    );
  }

  // 开始抓取
  async startScraping() {
    if (this.isRunning) return;

    // 检查是否在正确的页面
    if (!this.isOnCorrectPage()) {
      console.error("不在Twitter页面，无法开始抓取");
      return;
    }

    // 检查是否在时间线页面
    if (!this.isOnTimelinePage()) {
      console.log("当前不在时间线页面，导航到首页...");
      window.location.href = "https://x.com/home";
      return;
    }

    this.isRunning = true;
    console.log("开始抓取Twitter信息...");
    
    // 显示状态指示器
    this.showStatusIndicator(true);

    // 等待页面完全加载
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 立即抓取一次
    const currentTweets = await this.scrapeCurrentTweets();
    for (const tweet of currentTweets) {
      await this.addTweet(tweet);
    }

    // 添加AI回复按钮到所有推文
    this.addAiReplyButtons();

    // 阻止推文点击跳转
    this.preventTweetClicks();

    // 监听页面变化
    this.observer = new MutationObserver(async () => {
      const newTweets = await this.scrapeCurrentTweets();
      for (const tweet of newTweets) {
        await this.addTweet(tweet);
      }
      // 为新加载的推文添加AI回复按钮
      this.addAiReplyButtons();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // 定期保存数据
    this.saveInterval = setInterval(() => {
      this.saveData();
    }, 10000);
  }

  // 停止抓取
  stopScraping() {
    if (!this.isRunning) return;

    this.isRunning = false;
    console.log("停止抓取Twitter信息...");

    // 隐藏状态指示器
    this.showStatusIndicator(false);

    if (this.observer) {
      this.observer.disconnect();
    }

    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }

    this.saveData();
  }

  // 显示/隐藏状态指示器
  showStatusIndicator(show) {
    const indicatorId = 'twitter-scraper-indicator';
    let indicator = document.getElementById(indicatorId);
    
    if (show) {
      if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = indicatorId;
        indicator.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background: #1da1f2;
          color: white;
          padding: 8px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: bold;
          z-index: 10000;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          animation: pulse 2s infinite;
          cursor: pointer;
        `;
        
        // 添加脉冲动画
        const style = document.createElement('style');
        style.textContent = `
          @keyframes pulse {
            0% { opacity: 0.8; }
            50% { opacity: 1; }
            100% { opacity: 0.8; }
          }
        `;
        document.head.appendChild(style);
        
        document.body.appendChild(indicator);
        
        // 点击指示器显示提示
        indicator.addEventListener('click', () => {
          alert(`正在抓取推文...\n当前已抓取：${this.tweets.length} 条\n点击扩展图标查看详情`);
        });
        
        // 定期更新显示的推文数量
        this.updateIndicatorInterval = setInterval(() => {
          if (indicator && this.isRunning) {
            indicator.innerHTML = `🤖 已抓取 ${this.tweets.length} 条`;
          }
        }, 2000);
      }
      
      // 更新显示内容
      if (indicator) {
        indicator.innerHTML = `🤖 已抓取 ${this.tweets.length} 条`;
      }
    } else {
      if (indicator) {
        indicator.remove();
      }
      if (this.updateIndicatorInterval) {
        clearInterval(this.updateIndicatorInterval);
      }
    }
  }

  // 保存数据到Chrome存储
  saveData() {
    chrome.storage.local.set(
      {
        twitter_data: this.tweets,
        last_updated: new Date().toISOString(),
      },
      () => {
        console.log("数据已保存，共抓取到", this.tweets.length, "条推文");
      }
    );
  }

  // 添加AI回复按钮到所有推文
  addAiReplyButtons() {
    const tweetElements = document.querySelectorAll('[data-testid="tweet"]');
    
    tweetElements.forEach(tweetElement => {
      // 检查是否已经添加了AI回复按钮
      if (tweetElement.querySelector('.ai-reply-button')) {
        return;
      }

      // 查找原始回复按钮
      const replyButton = tweetElement.querySelector('[data-testid="reply"]');
      if (!replyButton) {
        return;
      }

      // 创建AI回复按钮
      const aiReplyButton = document.createElement('button');
      aiReplyButton.className = 'ai-reply-button';
      aiReplyButton.textContent = 'ai回复';
      aiReplyButton.style.cssText = `
        margin-left: 8px;
        padding: 4px 8px;
        background-color: #1d9bf0;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        font-family: inherit;
      `;

      // 添加点击事件
      aiReplyButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        // 显示加载状态
        const originalText = aiReplyButton.textContent;
        aiReplyButton.textContent = '生成中...';
        aiReplyButton.disabled = true;
        
        await this.handleAiReply(tweetElement);
        
        // 恢复原始状态
        aiReplyButton.textContent = originalText;
        aiReplyButton.disabled = false;
      });

      // 将按钮插入到回复按钮旁边
      const replyContainer = replyButton.closest('div[role="group"]');
      if (replyContainer) {
        replyContainer.appendChild(aiReplyButton);
      }
    });
  }

  // 处理AI回复点击
  async handleAiReply(tweetElement) {
    try {
      console.log('AI回复按钮被点击');
      
      // 获取推文内容
      const tweetText = tweetElement.querySelector('[data-testid="tweetText"]');
      if (!tweetText) {
        console.error('未找到推文内容');
        return;
      }
      
      const tweetContent = tweetText.textContent.trim();
      console.log('推文内容:', tweetContent);
      
      // 获取推文作者
      const authorElement = tweetElement.querySelector('[data-testid="User-Name"]');
      const author = authorElement ? authorElement.textContent.trim() : '';
      
      // 生成AI回复
      const aiReply = await this.generateAiReply(tweetContent, author);
      if (!aiReply) {
        console.error('AI回复生成失败');
        return;
      }
      
      // 查找回复按钮
      const replyButton = tweetElement.querySelector('[data-testid="reply"]');
      if (!replyButton) {
        console.error('未找到回复按钮');
        return;
      }

      // 点击回复按钮
      replyButton.click();

      // 等待回复框出现
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // 查找回复输入框
      const replyInput = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (!replyInput) {
        console.error('未找到回复输入框');
        return;
      }

      // 输入AI生成的回复内容
      replyInput.click();
      await new Promise((resolve) => setTimeout(resolve, 200));

      replyInput.focus();
      await new Promise((resolve) => setTimeout(resolve, 200));

      // 找到包含br[data-text="true"]的span元素并替换内容
      const textBr = replyInput.querySelector('br[data-text="true"]');
      if (textBr && textBr.parentElement) {
        const spanElement = textBr.parentElement;
        spanElement.innerHTML = aiReply;
        console.log('AI回复内容已输入:', aiReply);
      } else {
        console.error('未找到br[data-text="true"]元素');
      }

      // 触发输入事件
      const inputEvent = new Event('input', { bubbles: true });
      replyInput.dispatchEvent(inputEvent);

    } catch (error) {
      console.error('AI回复失败:', error);
    }
  }
  
  // 使用Gemini API生成回复
  async generateAiReply(tweetContent, author) {
    try {
      // 从存储中获取API Key
      const result = await chrome.storage.local.get(['twitter_config']);
      const config = result.twitter_config || {};
      const apiKey = config.apiKey;
      
      if (!apiKey) {
        console.error('未配置Gemini API Key');
        alert('请先在扩展设置中配置Gemini API Key');
        return null;
      }
      
      // 构建请求提示词
      const prompt = `请为以下推文生成一个简短、友好且相关的回复（不超过280字符）：

作者：${author}
推文内容：${tweetContent}

要求：
1. 回复要有意义且相关
2. 语气友好自然
3. 不超过280字符
4. 可以包含适当的表情符号
5. 直接返回回复内容，不要包含引号或其他格式`;
      
      // 调用Gemini API
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }]
        })
      });
      
      if (!response.ok) {
        throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
        const generatedText = data.candidates[0].content.parts[0].text.trim();
        console.log('AI生成的回复:', generatedText);
        return generatedText;
      } else {
        console.error('API响应格式不正确:', data);
        return null;
      }
      
    } catch (error) {
      console.error('调用Gemini API失败:', error);
      alert('AI回复生成失败: ' + error.message);
      return null;
    }
  }


  // 获取抓取的数据
  getData() {
    return this.tweets;
  }

  // 清除数据
  clearData() {
    this.tweets = [];
    this.tweetIds.clear();
    chrome.storage.local.remove(["twitter_data", "last_updated"]);
  }
}

// 创建全局实例
const twitterScraper = new TwitterScraper();

// 初始化时加载已存在的推文ID
chrome.storage.local.get(["twitter_data"]).then((result) => {
  const existingTweets = result.twitter_data || [];
  existingTweets.forEach((tweet) => {
    if (tweet.id) {
      twitterScraper.tweetIds.add(tweet.id);
    }
  });
  twitterScraper.tweets = existingTweets;
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 处理异步操作
  const handleAsync = async () => {
    try {
      switch (request.action) {
        case "ping":
          sendResponse({ status: "pong" });
          break;
        case "start_scraping":
          await twitterScraper.startScraping();
          sendResponse({ status: "started" });
          break;
        case "stop_scraping":
          twitterScraper.stopScraping();
          sendResponse({ status: "stopped" });
          break;
        case "get_data":
          sendResponse({ data: twitterScraper.getData() });
          break;
        case "clear_data":
          twitterScraper.clearData();
          sendResponse({ status: "cleared" });
          break;
        case "get_status":
          sendResponse({ isRunning: twitterScraper.isRunning });
          break;
        default:
          sendResponse({ error: "Unknown action: " + request.action });
      }
    } catch (error) {
      console.error('处理消息时出错:', error);
      sendResponse({ error: error.message });
    }
  };
  
  // 对于异步操作，立即返回true以保持消息通道开放
  if (request.action === "start_scraping") {
    handleAsync();
    return true; // 保持消息通道开放
  } else {
    handleAsync();
  }
});

// 页面加载完成后初始化并自动开始抓取
console.log("Twitter信息抓取器已加载");

// 自动启动函数
function tryAutoStart() {
  chrome.storage.local.get(['auto_start_scraping'], (result) => {
    const autoStart = result.auto_start_scraping !== false; // 默认为true
    
    if (autoStart && twitterScraper.isOnCorrectPage() && twitterScraper.isOnTimelinePage() && !twitterScraper.isRunning) {
      // 延迟启动，确保页面完全加载
      setTimeout(() => {
        console.log("自动开始抓取Twitter信息...");
        twitterScraper.startScraping();
      }, 2000);
    } else if (!autoStart) {
      console.log("自动抓取已禁用，等待用户手动启动...");
    } else if (twitterScraper.isRunning) {
      console.log("抓取已在运行中");
    } else {
      console.log("不在合适的页面，等待用户导航到Twitter时间线...");
    }
  });
}

// 初始启动
tryAutoStart();

// 监听URL变化（适用于SPA导航）
let currentUrl = window.location.href;
setInterval(() => {
  if (currentUrl !== window.location.href) {
    currentUrl = window.location.href;
    console.log("检测到页面导航，重新检查自动启动条件");
    setTimeout(tryAutoStart, 1000); // 等待页面内容加载
  }
}, 1000);
