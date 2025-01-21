// 监听标签页更新事件
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    console.log('标签页更新:', tab.title);
  }
});

// 监听标签页创建事件
chrome.tabs.onCreated.addListener((tab) => {
  console.log('新标签页创建:', tab.title);
});

// 监听标签组更新事件
chrome.tabGroups.onUpdated.addListener((group) => {
  console.log('标签组更新:', group);
});

// 接收来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTabGroups') {
    chrome.tabGroups.query({}).then(groups => {
      sendResponse({ groups });
    });
    return true;
  }
});