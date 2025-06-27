// Popup界面控制脚本
class PopupController {
  constructor() {
    this.initializeElements();
    this.bindEvents();
    this.updateStatus();
    this.updateStats();
    this.startAutoRefresh();
  }

  initializeElements() {
    this.statusDiv = document.getElementById('status');
    this.startBtn = document.getElementById('startBtn');
    this.stopBtn = document.getElementById('stopBtn');
    this.clearBtn = document.getElementById('clearBtn');
    this.exportBtn = document.getElementById('exportBtn');
    this.analyzeBtn = document.getElementById('analyzeBtn');
    this.tweetCount = document.getElementById('tweetCount');
    this.lastUpdate = document.getElementById('lastUpdate');
    this.exportFormat = document.getElementById('exportFormat');
    this.apiKeyInput = document.getElementById('apiKey');
    this.autoStartCheckbox = document.getElementById('autoStartScraping');
    this.saveConfigBtn = document.getElementById('saveConfigBtn');
    this.analysisResult = document.getElementById('analysisResult');
    this.trendingTopics = document.getElementById('trendingTopics');
    this.generatedTweet = document.getElementById('generatedTweet');
    this.copyTweetBtn = document.getElementById('copyTweetBtn');
  }

  bindEvents() {
    this.startBtn.addEventListener('click', () => this.startScraping());
    this.stopBtn.addEventListener('click', () => this.stopScraping());
    this.clearBtn.addEventListener('click', () => this.clearData());
    this.exportBtn.addEventListener('click', () => this.exportData());
    this.analyzeBtn.addEventListener('click', () => this.analyzeTrends());
    this.saveConfigBtn.addEventListener('click', () => this.saveConfig());
    this.copyTweetBtn.addEventListener('click', () => this.copyGeneratedTweet());
    this.loadConfig();
  }

  // 获取当前活动标签页
  async getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // 发送消息到内容脚本
  async sendMessageToContent(action) {
    try {
      const tab = await this.getCurrentTab();
      
      // 检查标签页是否有效
      if (!tab || !tab.id) {
        throw new Error('无法获取当前标签页');
      }
      
      // 检查是否在Twitter页面
      if (!tab.url || (!tab.url.includes('twitter.com') && !tab.url.includes('x.com'))) {
        throw new Error('当前页面不是Twitter/X页面');
      }
      
      // 尝试发送消息，并设置超时
      const response = await Promise.race([
        chrome.tabs.sendMessage(tab.id, { action }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('消息发送超时')), 5000)
        )
      ]);
      
      return response;
    } catch (error) {
      console.error('发送消息失败:', error);
      
      // 根据错误类型提供更具体的错误信息
      if (error.message.includes('Receiving end does not exist')) {
        console.log('内容脚本未加载，尝试重新注入...');
        return { error: 'content_script_not_loaded' };
      } else if (error.message.includes('Cannot access')) {
        console.log('无法访问页面，可能是权限问题');
        return { error: 'permission_denied' };
      } else {
        return { error: error.message };
      }
    }
  }

  // 开始抓取
  async startScraping() {
    try {
      const tab = await this.getCurrentTab();
      
      // 如果不在Twitter页面，先导航到Twitter首页
      if (!tab.url.includes('twitter.com') && !tab.url.includes('x.com')) {
        console.log('导航到Twitter首页...');
        await chrome.tabs.update(tab.id, { url: 'https://x.com/home' });
        
        // 等待页面加载完成
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 重新获取标签页信息
        const updatedTab = await chrome.tabs.get(tab.id);
        if (!updatedTab.url.includes('x.com')) {
          this.showMessage('导航到Twitter失败，请手动访问Twitter', 'error');
          return;
        }
      }
      
      // 先测试连接
      const pingResponse = await this.sendMessageToContent('ping');
      
      // 发送开始抓取命令
      const response = await this.sendMessageToContent('start_scraping');
      
      if (response && response.status === 'started') {
        this.updateStatus(true);
        this.showMessage('开始自动抓取Twitter信息...', 'success');
      } else if (response && response.error) {
        // 处理特定错误类型
        if (response.error === 'content_script_not_loaded') {
          console.log('内容脚本未加载，尝试重新注入...');
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tab.id },
              files: ['content.js']
            });
            
            // 等待脚本加载并重试
            await new Promise(resolve => setTimeout(resolve, 2000));
            const retryResponse = await this.sendMessageToContent('start_scraping');
            
            if (retryResponse && retryResponse.status === 'started') {
              this.updateStatus(true);
              this.showMessage('开始自动抓取Twitter信息...', 'success');
            } else {
              this.showMessage('启动抓取失败，请刷新页面后重试', 'error');
            }
          } catch (injectError) {
            console.error('注入内容脚本失败:', injectError);
            this.showMessage('启动失败，请刷新Twitter页面后重试', 'error');
          }
        } else if (response.error === 'permission_denied') {
          this.showMessage('权限不足，请确保在Twitter页面使用', 'error');
        } else {
          this.showMessage(`启动失败: ${response.error}`, 'error');
        }
      } else {
        this.showMessage('启动抓取失败，请重试', 'error');
      }
    } catch (error) {
      console.error('开始抓取时出错:', error);
      this.showMessage('启动失败: ' + error.message, 'error');
    }
  }

  // 停止抓取
  async stopScraping() {
    const response = await this.sendMessageToContent('stop_scraping');
    if (response && response.status === 'stopped') {
      this.updateStatus(false);
      this.updateStats();
      this.showMessage('已停止抓取', 'info');
    } else if (response && response.error) {
      console.log('停止抓取时出现错误:', response.error);
      // 即使通信失败，也更新本地状态
      this.updateStatus(false);
      this.showMessage('已停止抓取（通信异常）', 'info');
    } else {
      this.updateStatus(false);
      this.showMessage('停止抓取失败，但已更新本地状态', 'info');
    }
  }

  // 清除数据
  async clearData() {
    if (confirm('确定要清除所有抓取的数据吗？')) {
      const response = await this.sendMessageToContent('clear_data');
      
      // 无论通信是否成功，都清除本地存储的数据
      try {
        await chrome.storage.local.clear();
        this.updateStats();
        
        if (response && response.status === 'cleared') {
          this.showMessage('数据已清除', 'info');
        } else if (response && response.error) {
          this.showMessage('数据已清除（通信异常）', 'info');
        } else {
          this.showMessage('本地数据已清除', 'info');
        }
      } catch (error) {
        console.error('清除数据失败:', error);
        this.showMessage('清除数据失败: ' + error.message, 'error');
      }
    }
  }

  // 导出数据
  async exportData() {
    try {
      const result = await chrome.storage.local.get(['twitter_data']);
      const data = result.twitter_data || [];
      
      if (data.length === 0) {
        alert('没有数据可导出！');
        return;
      }

      const format = this.exportFormat.value;
      let content = '';
      let filename = `twitter_data_${new Date().getTime()}`;

      switch (format) {
        case 'json':
          content = JSON.stringify(data, null, 2);
          filename += '.json';
          break;
        case 'csv':
          content = this.convertToCSV(data);
          filename += '.csv';
          break;
        case 'txt':
          content = this.convertToTXT(data);
          filename += '.txt';
          break;
      }

      this.downloadFile(content, filename);
      this.showMessage(`已导出 ${data.length} 条数据`, 'success');
    } catch (error) {
      console.error('导出失败:', error);
      alert('导出失败：' + error.message);
    }
  }

  // 转换为CSV格式
  convertToCSV(data) {
    const headers = ['作者', '用户名', '内容', '时间', '点赞', '转发', '回复', '图片', '链接'];
    const csvContent = [headers.join(',')];
    
    data.forEach(tweet => {
      const row = [
        `"${tweet.author || ''}"`,
        `"${tweet.username || ''}"`,
        `"${(tweet.content || '').replace(/"/g, '""')}"`,
        `"${tweet.time || ''}"`,
        `"${tweet.likes || '0'}"`,
        `"${tweet.retweets || '0'}"`,
        `"${tweet.replies || '0'}"`,
        `"${(tweet.images || []).join('; ')}"`,
        `"${(tweet.links || []).join('; ')}"`,
      ];
      csvContent.push(row.join(','));
    });
    
    return csvContent.join('\n');
  }

  // 转换为文本格式
  convertToTXT(data) {
    let content = '# Twitter数据导出\n\n';
    content += `导出时间: ${new Date().toLocaleString()}\n`;
    content += `总计: ${data.length} 条推文\n\n`;
    content += '=' .repeat(50) + '\n\n';
    
    data.forEach((tweet, index) => {
      content += `[${index + 1}] ${tweet.author} (@${tweet.username})\n`;
      content += `时间: ${tweet.time}\n`;
      content += `内容: ${tweet.content}\n`;
      content += `互动: 👍${tweet.likes} 🔁${tweet.retweets} 💬${tweet.replies}\n`;
      if (tweet.images && tweet.images.length > 0) {
        content += `图片: ${tweet.images.join(', ')}\n`;
      }
      if (tweet.links && tweet.links.length > 0) {
        content += `链接: ${tweet.links.join(', ')}\n`;
      }
      content += '\n' + '-'.repeat(50) + '\n\n';
    });
    
    return content;
  }

  // 下载文件
  downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // 更新状态显示
  async updateStatus(isRunning = null) {
    if (isRunning === null) {
      const response = await this.sendMessageToContent('get_status');
      if (response && typeof response.isRunning === 'boolean') {
        isRunning = response.isRunning;
      } else {
        // 如果无法获取状态，默认为停止状态
        isRunning = false;
      }
    }

    if (isRunning) {
      this.statusDiv.textContent = '状态：正在抓取...';
      this.statusDiv.className = 'status running';
      this.startBtn.disabled = true;
      this.stopBtn.disabled = false;
    } else {
      this.statusDiv.textContent = '状态：已停止';
      this.statusDiv.className = 'status stopped';
      this.startBtn.disabled = false;
      this.stopBtn.disabled = true;
    }
  }

  // 更新统计信息
  async updateStats() {
    try {
      const result = await chrome.storage.local.get(['twitter_data', 'last_updated']);
      const data = result.twitter_data || [];
      const lastUpdated = result.last_updated;

      this.tweetCount.textContent = data.length;
      
      if (lastUpdated) {
        const date = new Date(lastUpdated);
        this.lastUpdate.textContent = date.toLocaleString();
      } else {
        this.lastUpdate.textContent = '未更新';
      }
    } catch (error) {
      console.error('更新统计信息失败:', error);
    }
  }

  // 开始自动刷新
  startAutoRefresh() {
    // 每2秒更新一次统计信息
    this.refreshInterval = setInterval(() => {
      this.updateStats();
    }, 2000);
    
    // 监听存储变化
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.twitter_data) {
        this.updateStats();
      }
    });
  }

  // 停止自动刷新
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }

  // 保存配置
  async saveConfig() {
    try {
      const config = {
        apiKey: this.apiKeyInput.value.trim()
      };
      
      await chrome.storage.local.set({ 
        'twitter_config': config,
        'auto_start_scraping': this.autoStartCheckbox.checked
      });
      this.showMessage('配置已保存', 'success');
    } catch (error) {
      console.error('保存配置失败:', error);
      this.showMessage('配置保存失败', 'error');
    }
  }

  // 加载配置
  async loadConfig() {
    try {
      const result = await chrome.storage.local.get(['twitter_config', 'auto_start_scraping']);
      const config = result.twitter_config || {};
      const autoStart = result.auto_start_scraping === true; // 默认为false
      
      this.apiKeyInput.value = config.apiKey || '';
      this.autoStartCheckbox.checked = autoStart;
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  }

  // 分析推文热点并生成推文
  async analyzeTrends() {
    try {
      // 检查API Key
      const result = await chrome.storage.local.get(['twitter_config', 'twitter_data']);
      const config = result.twitter_config || {};
      const data = result.twitter_data || [];
      
      if (!config.apiKey) {
        alert('请先配置Gemini API Key');
        return;
      }
      
      if (data.length === 0) {
        alert('没有抓取到推文数据，请先开始抓取');
        return;
      }
      
      // 显示加载状态
      this.analyzeBtn.textContent = '分析中...';
      this.analyzeBtn.disabled = true;
      
      // 过滤最近推文（今日或最近24小时）
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      let recentTweets = data.filter(tweet => {
        if (!tweet.time) return false;
        const tweetDate = new Date(tweet.time);
        return tweetDate >= yesterday;
      });
      
      // 如果最近24小时推文少于10条，扩展到最近100条
      if (recentTweets.length < 10) {
        recentTweets = data.slice(-100); // 取最新的100条
        console.log(`最近24小时推文较少(${recentTweets.length}条)，扩展分析范围到最新100条推文`);
      }
      
      if (recentTweets.length === 0) {
        alert('没有找到推文数据，请先开始抓取');
        this.analyzeBtn.textContent = '分析热点并生成推文';
        this.analyzeBtn.disabled = false;
        return;
      }
      
      console.log(`准备分析 ${recentTweets.length} 条推文`);
      
      // 调用Gemini API进行分析
      const analysis = await this.callGeminiForAnalysis(recentTweets, config.apiKey);
      
      if (analysis) {
        this.displayAnalysisResult(analysis);
      }
      
    } catch (error) {
      console.error('分析失败:', error);
      alert('分析失败: ' + error.message);
    } finally {
      this.analyzeBtn.textContent = '分析热点并生成推文';
      this.analyzeBtn.disabled = false;
    }
  }
  
  // 智能选择用于分析的推文
  selectTweetsForAnalysis(sortedTweets) {
    const maxTweets = 60; // 增加到60条
    const result = [];
    
    if (sortedTweets.length <= maxTweets) {
      return sortedTweets;
    }
    
    // 分层选择策略：
    // 1. 前20条最热门推文
    const topHot = sortedTweets.slice(0, 20);
    result.push(...topHot);
    
    // 2. 从剩余推文中按时间分布选择40条
    const remaining = sortedTweets.slice(20);
    const timeDistributed = this.selectByTimeDistribution(remaining, 40);
    result.push(...timeDistributed);
    
    console.log(`从 ${sortedTweets.length} 条推文中选择了 ${result.length} 条进行分析`);
    return result;
  }
  
  // 按时间分布选择推文
  selectByTimeDistribution(tweets, count) {
    if (tweets.length <= count) return tweets;
    
    const step = Math.floor(tweets.length / count);
    const result = [];
    
    for (let i = 0; i < count && i * step < tweets.length; i++) {
      result.push(tweets[i * step]);
    }
    
    return result;
  }
  
  // 调用Gemini API进行热点分析
  async callGeminiForAnalysis(tweets, apiKey) {
    try {
      // 按热度排序推文（点赞+转发数）
      const sortedTweets = tweets.sort((a, b) => {
        const scoreA = (parseInt(a.likes) || 0) + (parseInt(a.retweets) || 0);
        const scoreB = (parseInt(b.likes) || 0) + (parseInt(b.retweets) || 0);
        return scoreB - scoreA;
      });
      
      // 智能选择推文：热门推文 + 时间分布
      const selectedTweets = this.selectTweetsForAnalysis(sortedTweets);
      
      // 准备推文数据，只取最有价值的信息
      const tweetSummaries = selectedTweets.map(tweet => ({
        author: tweet.author,
        content: tweet.content.substring(0, 180), // 稍微增加长度
        likes: tweet.likes,
        retweets: tweet.retweets,
        time: tweet.time
      }));
      
      const prompt = `请分析以下Twitter推文数据，识别热点话题并创作一条原创推文。

数据说明：共${tweetSummaries.length}条推文，已按互动量排序

推文数据：
${JSON.stringify(tweetSummaries, null, 2)}

请严格按照以下格式返回：

热点话题：
1. 话题名称 - 描述内容
2. 话题名称 - 描述内容  
3. 话题名称 - 描述内容

推荐推文：
生成的推文内容（280字符以内）

创作要求：
- 识别3-5个当前热门话题或趋势
- 推文必须是原创观点，不能照抄现有内容
- 要有独特的见解、思考角度或个人观点
- 可以是对热点的评论、反思、预测或不同视角
- 语气要有个性，可以幽默、深刻或犀利
- 避免人云亦云，要有自己的立场和想法
- 280字符以内，可使用表情符号增强表达力

注意：生成的推文应该是基于热点的原创思考，而不是简单重复或总结现有观点。`;

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
        const analysisText = data.candidates[0].content.parts[0].text.trim();
        console.log('API返回的原始文本:', analysisText);
        
        // 如果解析失败，显示原始文本供调试
        const parsedResult = this.parseAnalysisResult(analysisText);
        if (!parsedResult.topics.length || !parsedResult.tweet.trim()) {
          console.warn('解析结果不完整，显示原始文本');
          return {
            topics: [`原始响应: ${analysisText.substring(0, 200)}...`],
            tweet: analysisText.substring(0, 280)
          };
        }
        
        return parsedResult;
      } else {
        console.error('API响应数据:', data);
        throw new Error('API响应格式不正确');
      }
    } catch (error) {
      console.error('调用Gemini API失败:', error);
      throw error;
    }
  }
  
  // 解析分析结果
  parseAnalysisResult(text) {
    try {
      console.log('原始AI响应:', text);
      
      const lines = text.split('\n').filter(line => line.trim());
      const topics = [];
      let generatedTweet = '';
      let inTopicsSection = false;
      let inTweetSection = false;
      
      for (let i = 0; i < lines.length; i++) {
        const trimmedLine = lines[i].trim();
        console.log(`解析第${i}行: "${trimmedLine}"`);
        
        // 更灵活的章节识别
        if (trimmedLine.includes('热点话题') || trimmedLine.includes('话题：') || 
            trimmedLine.includes('热点') || trimmedLine.includes('趋势')) {
          inTopicsSection = true;
          inTweetSection = false;
          console.log('进入话题部分');
          continue;
        }
        
        if (trimmedLine.includes('推荐推文') || trimmedLine.includes('推文：') || 
            trimmedLine.includes('生成推文') || trimmedLine.includes('建议推文')) {
          inTopicsSection = false;
          inTweetSection = true;
          console.log('进入推文部分');
          continue;
        }
        
        // 更灵活的话题识别
        if (inTopicsSection) {
          if (trimmedLine.match(/^\d+[\.\)、]/) || // 1. 或 1) 或 1、
              trimmedLine.match(/^[•\-\*]/) ||    // • - *
              (trimmedLine.includes('-') && trimmedLine.length > 5)) {
            topics.push(trimmedLine);
            console.log('找到话题:', trimmedLine);
          }
        }
        
        // 更灵活的推文识别
        if (inTweetSection) {
          if (trimmedLine && 
              !trimmedLine.includes('要求') && 
              !trimmedLine.includes('分析要求') &&
              !trimmedLine.includes('注意') &&
              !trimmedLine.includes('说明') &&
              !trimmedLine.endsWith('：') &&
              !trimmedLine.endsWith(':')) {
            generatedTweet += trimmedLine + ' ';
            console.log('添加推文内容:', trimmedLine);
          }
        }
      }
      
      // 如果没有找到话题，尝试更宽松的匹配
      if (topics.length === 0) {
        console.log('未找到话题，尝试宽松匹配...');
        const allLines = text.split('\n').filter(line => line.trim());
        for (const line of allLines) {
          const trimmed = line.trim();
          if (trimmed.match(/^\d+[\.\)、]/) && trimmed.length > 3) {
            topics.push(trimmed);
          }
        }
        
        // 如果还是没找到，手动提取关键内容
        if (topics.length === 0) {
          console.log('仍未找到话题，使用简单提取...');
          const sentences = text.split(/[。．\n]/).filter(s => s.trim().length > 10);
          topics.push(...sentences.slice(0, 3).map((s, i) => `${i+1}. ${s.trim()}`));
        }
      }
      
      // 如果没有找到推文，尝试查找较长的文本行
      if (!generatedTweet.trim()) {
        console.log('未找到推文，尝试查找长文本...');
        const allLines = text.split('\n').filter(line => line.trim());
        for (const line of allLines) {
          const trimmed = line.trim();
          if (trimmed.length > 20 && 
              !trimmed.includes('分析') && 
              !trimmed.includes('要求') &&
              !trimmed.includes('格式') &&
              !trimmed.endsWith('：')) {
            generatedTweet = trimmed;
            break;
          }
        }
      }
      
      const result = {
        topics: topics.slice(0, 5),
        tweet: generatedTweet.trim()
      };
      
      console.log('解析结果:', result);
      return result;
      
    } catch (error) {
      console.error('解析分析结果失败:', error);
      return {
        topics: ['解析失败，请重试'],
        tweet: '分析结果解析失败，请重新尝试'
      };
    }
  }
  
  // 显示分析结果
  displayAnalysisResult(analysis) {
    console.log('显示分析结果:', analysis);
    
    // 显示热点话题
    this.trendingTopics.innerHTML = '';
    
    if (analysis.topics && analysis.topics.length > 0) {
      analysis.topics.forEach((topic, index) => {
        const topicDiv = document.createElement('div');
        topicDiv.className = 'trending-topic';
        topicDiv.textContent = topic || `话题 ${index + 1}: 数据解析中...`;
        this.trendingTopics.appendChild(topicDiv);
      });
    } else {
      const noTopicDiv = document.createElement('div');
      noTopicDiv.className = 'trending-topic';
      noTopicDiv.textContent = '暂无热点话题数据，请重试或检查数据';
      noTopicDiv.style.color = '#999';
      this.trendingTopics.appendChild(noTopicDiv);
    }
    
    // 显示生成的推文
    if (analysis.tweet && analysis.tweet.trim()) {
      this.generatedTweet.textContent = analysis.tweet;
    } else {
      this.generatedTweet.textContent = '推文生成失败，请重试';
      this.generatedTweet.style.color = '#999';
    }
    
    // 显示结果区域
    this.analysisResult.style.display = 'block';
  }
  
  // 复制生成的推文
  async copyGeneratedTweet() {
    try {
      const tweetText = this.generatedTweet.textContent;
      if (!tweetText) {
        alert('没有推文可复制');
        return;
      }
      
      await navigator.clipboard.writeText(tweetText);
      const originalText = this.copyTweetBtn.textContent;
      this.copyTweetBtn.textContent = '已复制!';
      
      setTimeout(() => {
        this.copyTweetBtn.textContent = originalText;
      }, 2000);
    } catch (error) {
      console.error('复制失败:', error);
      alert('复制失败，请手动复制');
    }
  }

  // 显示消息提示
  showMessage(message, type = 'info') {
    // 简单的消息提示实现
    const originalText = this.statusDiv.textContent;
    this.statusDiv.textContent = message;
    
    setTimeout(() => {
      this.updateStatus();
    }, 2000);
  }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
  const controller = new PopupController();
  
  // 页面关闭时清理资源
  window.addEventListener('beforeunload', () => {
    controller.stopAutoRefresh();
  });
});