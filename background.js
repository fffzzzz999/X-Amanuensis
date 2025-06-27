// 后台脚本 - 处理扩展程序的后台任务
class BackgroundService {
  constructor() {
    this.setupEventListeners();
    this.initializeStorage();
  }

  // 设置事件监听器
  setupEventListeners() {
    // 扩展程序安装时
    chrome.runtime.onInstalled.addListener((details) => {
      console.log('Twitter信息抓取器已安装');
      if (details.reason === 'install') {
        this.showWelcomeNotification();
      }
    });

    // 监听来自内容脚本和popup的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // 保持消息通道开放
    });

    // 标签页更新时
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && this.isTwitterTab(tab.url)) {
        this.onTwitterTabReady(tabId);
      }
    });

    // 定期清理旧数据
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'cleanup') {
        this.cleanupOldData();
      }
    });
  }

  // 初始化存储
  async initializeStorage() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      if (!result.settings) {
        const defaultSettings = {
          maxTweets: 1000,
          autoCleanupDays: 7,
          exportFormat: 'json'
        };
        await chrome.storage.local.set({ settings: defaultSettings });
      }
      
      // 设置定期清理
      chrome.alarms.create('cleanup', { periodInMinutes: 60 });
    } catch (error) {
      console.error('初始化存储失败:', error);
    }
  }

  // 处理消息
  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'get_storage_usage':
          const usage = await this.getStorageUsage();
          sendResponse({ usage });
          break;
          
        case 'backup_data':
          const backup = await this.backupData();
          sendResponse({ backup });
          break;
          
        case 'restore_data':
          const restored = await this.restoreData(request.data);
          sendResponse({ success: restored });
          break;
          
        case 'get_stats':
          const stats = await this.getDetailedStats();
          sendResponse({ stats });
          break;
          
        default:
          sendResponse({ error: '未知操作' });
      }
    } catch (error) {
      console.error('处理消息时出错:', error);
      sendResponse({ error: error.message });
    }
  }

  // 检查是否为Twitter标签页
  isTwitterTab(url) {
    return url && (url.includes('twitter.com') || url.includes('x.com'));
  }

  // Twitter标签页准备就绪
  async onTwitterTabReady(tabId) {
    try {
      // 检查内容脚本是否已注入
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    } catch (error) {
      // 如果内容脚本未注入，则注入它
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
      } catch (injectError) {
        console.error('注入内容脚本失败:', injectError);
      }
    }
  }

  // 显示欢迎通知
  showWelcomeNotification() {
    chrome.notifications.create({
      type: 'basic',
      title: 'Twitter信息抓取器',
      message: '扩展程序已安装！请访问Twitter页面开始使用。'
    });
  }

  // 获取存储使用情况
  async getStorageUsage() {
    try {
      const data = await chrome.storage.local.get(null);
      const size = JSON.stringify(data).length;
      const maxSize = chrome.storage.local.QUOTA_BYTES || 5242880; // 5MB
      return {
        used: size,
        total: maxSize,
        percentage: Math.round((size / maxSize) * 100)
      };
    } catch (error) {
      console.error('获取存储使用情况失败:', error);
      return { used: 0, total: 0, percentage: 0 };
    }
  }

  // 备份数据
  async backupData() {
    try {
      const data = await chrome.storage.local.get(['twitter_data', 'settings']);
      const backup = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        data: data.twitter_data || [],
        settings: data.settings || {}
      };
      return backup;
    } catch (error) {
      console.error('备份数据失败:', error);
      return null;
    }
  }

  // 恢复数据
  async restoreData(backupData) {
    try {
      if (!backupData || !backupData.data) {
        throw new Error('无效的备份数据');
      }
      
      await chrome.storage.local.set({
        twitter_data: backupData.data,
        settings: backupData.settings || {},
        last_updated: new Date().toISOString()
      });
      
      return true;
    } catch (error) {
      console.error('恢复数据失败:', error);
      return false;
    }
  }

  // 获取详细统计信息
  async getDetailedStats() {
    try {
      const result = await chrome.storage.local.get(['twitter_data']);
      const tweets = result.twitter_data || [];
      
      if (tweets.length === 0) {
        return {
          total: 0,
          authors: 0,
          avgLikes: 0,
          avgRetweets: 0,
          dateRange: null
        };
      }

      // 统计作者数量
      const uniqueAuthors = new Set(tweets.map(t => t.author)).size;
      
      // 计算平均点赞和转发
      const totalLikes = tweets.reduce((sum, t) => sum + (parseInt(t.likes) || 0), 0);
      const totalRetweets = tweets.reduce((sum, t) => sum + (parseInt(t.retweets) || 0), 0);
      
      // 日期范围
      const dates = tweets.map(t => new Date(t.time)).filter(d => !isNaN(d));
      const dateRange = dates.length > 0 ? {
        start: new Date(Math.min(...dates)).toLocaleDateString(),
        end: new Date(Math.max(...dates)).toLocaleDateString()
      } : null;

      return {
        total: tweets.length,
        authors: uniqueAuthors,
        avgLikes: Math.round(totalLikes / tweets.length),
        avgRetweets: Math.round(totalRetweets / tweets.length),
        dateRange
      };
    } catch (error) {
      console.error('获取统计信息失败:', error);
      return null;
    }
  }

  // 清理旧数据
  async cleanupOldData() {
    try {
      const result = await chrome.storage.local.get(['twitter_data', 'settings']);
      const tweets = result.twitter_data || [];
      const settings = result.settings || {};
      
      const maxTweets = settings.maxTweets || 1000;
      const cleanupDays = settings.autoCleanupDays || 7;
      
      if (tweets.length > maxTweets) {
        // 按时间排序，保留最新的推文
        const sortedTweets = tweets.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const cleanedTweets = sortedTweets.slice(0, maxTweets);
        
        await chrome.storage.local.set({
          twitter_data: cleanedTweets,
          last_cleanup: new Date().toISOString()
        });
        
        console.log(`已清理 ${tweets.length - cleanedTweets.length} 条旧推文`);
      }
      
      // 清理过期数据
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - cleanupDays);
      
      const filteredTweets = tweets.filter(tweet => {
        const tweetDate = new Date(tweet.timestamp);
        return tweetDate > cutoffDate;
      });
      
      if (filteredTweets.length !== tweets.length) {
        await chrome.storage.local.set({ twitter_data: filteredTweets });
        console.log(`已清理 ${tweets.length - filteredTweets.length} 条过期推文`);
      }
    } catch (error) {
      console.error('清理数据失败:', error);
    }
  }
}

// 初始化后台服务
const backgroundService = new BackgroundService();