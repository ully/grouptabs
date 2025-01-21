// 获取当前窗口的所有标签页信息
async function getCurrentWindowTabs() {
  return await chrome.tabs.query({ currentWindow: true });
}

// 获取标签页内容
async function getTabContent(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) {
      console.error('无法访问其他扩展程序或Chrome内部页面的URL');
      return '';
    }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.body.innerText,
    });
    return result;
  } catch (error) {
    console.error(`无法读取标签页内容: ${error}`);
    return '';
  }
}

// 获取URL的域名
function getDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostParts = urlObj.hostname.split('.');
    if (hostParts.length > 2) {
      // 对于类似 a.baidu.com 的域名，返回 baidu.com
      return hostParts.slice(-2).join('.');
    }
    return urlObj.hostname;
  } catch (error) {
    console.error(`无法解析URL: ${error}`);
    return '';
  }
}

// 对标签页进行分组
async function groupTabs(tabs) {
  const groups = [];
  const processedTabs = new Set();
  const domainGroups = new Map();
  
  // 按域名分组
  for (const tab of tabs) {
    if (processedTabs.has(tab.id)) continue;
    
    const domain = getDomain(tab.url);
    if (!domain) continue;
    
    if (!domainGroups.has(domain)) {
      domainGroups.set(domain, {
        title: domain,
        tabs: [],
      });
    }
    
    domainGroups.get(domain).tabs.push(tab);
    processedTabs.add(tab.id);
  }
  
  // 将域名组转换为标签组，只处理包含多个标签页的组
  for (const [domain, domainGroup] of domainGroups) {
    if (domainGroup.tabs.length > 1) {
      groups.push({
        title: domain,
        tabs: domainGroup.tabs,
        color: 'grey'
      });
    }
  }
    // 对未分组的标签进行标题相似度分组
  // 获取所有已经被分到多标签域名组的标签ID
  const multiTabDomainGroupTabIds = new Set();
  for (const [domain, domainGroup] of domainGroups) {
    if (domainGroup.tabs.length > 1) {
      domainGroup.tabs.forEach(tab => multiTabDomainGroupTabIds.add(tab.id));
    }
  }
  
  // 只处理未被分到多标签域名组的标签
  const remainingTabs = tabs.filter(tab => {
    return !multiTabDomainGroupTabIds.has(tab.id);
  });
  const titleGroups = new Map();
  
  // 提取标题中的关键词并进行分组
  for (const tab of remainingTabs) {
    // 移除标点符号，将标题转为小写
    const title = tab.title.toLowerCase().replace(/[.,?!，。？！]/g, '');
    
    // 提取所有可能的连续片段（包括中英文混合）
    const segments = [];
    let currentSegment = '';
    
    for (let i = 0; i < title.length; i++) {
      const char = title[i];
      const isChineseChar = /[\u4e00-\u9fa5]/.test(char);
      const isAlphaNumeric = /[A-Za-z0-9]/.test(char);
      
      if (isChineseChar || isAlphaNumeric) {
        currentSegment += char;
      } else if (currentSegment) {
        if (currentSegment.length > 1) {
          segments.push(currentSegment);
        }
        currentSegment = '';
      }
    }
    
    if (currentSegment && currentSegment.length > 1) {
      segments.push(currentSegment);
    }
    
    // 分离中英文
    const words = segments.reduce((acc, segment) => {
      // 提取连续的中文字符
      const chineseMatches = segment.match(/[\u4e00-\u9fa5]+/g) || [];
      // 提取连续的英文和数字
      const alphaNumericMatches = segment.match(/[A-Za-z0-9]+/g) || [];
      return [...acc, ...chineseMatches, ...alphaNumericMatches];
    }, []).filter(word => word.length > 1);
    let matched = false;
    
    // 检查是否可以加入现有组
    for (const [groupKey, titleGroup] of titleGroups) {
      const groupWords = groupKey.split('|');
      // 计算完全匹配的关键词数量
      const commonWords = words.filter(word => {
        return groupWords.some(groupWord => 
          groupWord.toLowerCase() === word.toLowerCase() ||
          groupWord.toLowerCase().includes(word.toLowerCase()) ||
          word.toLowerCase().includes(groupWord.toLowerCase())
        );
      });
      
      if (commonWords.length > 0) {
        if (!titleGroup.tabs) titleGroup.tabs = [];
        titleGroup.tabs.push(tab);
        matched = true;
        processedTabs.add(tab.id);
        break;
      }
    }
    
    // 如果没有匹配的组，创建新组
    if (!matched) {
      const groupKey = words.join('|');
      titleGroups.set(groupKey, {
        title: words[0], // 初始设置第一个关键词为标题
        keywords: words, // 保存所有关键词以便后续统计
        tabs: [tab],
        color: 'purple'
      });
      processedTabs.add(tab.id);
    }
  }
  
  // 将标题相似度组添加到groups中（只添加包含多个标签的组）
  for (const titleGroup of titleGroups.values()) {
    if (titleGroup.tabs.length > 1) {
      // 统计每个关键词在组内标签中出现的次数
      const wordFrequency = new Map();
      titleGroup.keywords.forEach(keyword => {
        let count = 0;
        titleGroup.tabs.forEach(tab => {
          const title = tab.title.toLowerCase();
          if (title.includes(keyword.toLowerCase())) {
            count++;
          }
        });
        wordFrequency.set(keyword, count);
      });
      
      // 选择出现次数最多的关键词作为组名
      let maxCount = 0;
      let mostFrequentWord = titleGroup.keywords[0];
      for (const [word, count] of wordFrequency) {
        if (count > maxCount) {
          maxCount = count;
          mostFrequentWord = word;
        }
      }
      titleGroup.title = mostFrequentWord;
      groups.push(titleGroup);
    }
  }
  
  return groups;
}

// 创建Chrome标签组
async function createChromeTabGroup(group) {
  const tabIds = group.tabs.map(tab => tab.id);
  const groupId = await chrome.tabs.group({ tabIds });
  await chrome.tabGroups.update(groupId, {
    title: group.title,
    color: group.color,
    collapsed: true // 设置标签组为折叠状态
  });
  return groupId;
}

// 更新UI显示
function updateUI(groups) {
  const groupList = document.getElementById('groupList');
  groupList.innerHTML = '';
  
  groups.forEach((group, index) => {
    const groupElement = document.createElement('div');
    groupElement.className = 'group-item';
    
    const groupHeader = document.createElement('div');
    groupHeader.className = 'group-header';
    
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = group.title;
    titleInput.className = 'group-title';
    
    const colorPicker = document.createElement('input');
    colorPicker.type = 'color';
    colorPicker.className = 'color-picker';
    colorPicker.value = '#666666';
    
    const tabList = document.createElement('div');
    tabList.className = 'tab-list';
    
    group.tabs.forEach(tab => {
      const tabElement = document.createElement('div');
      tabElement.className = 'tab-item';
      
      const favicon = document.createElement('img');
      favicon.src = tab.favIconUrl || 'icons/icon16.png';
      favicon.className = 'tab-favicon';
      
      const title = document.createElement('span');
      title.textContent = tab.title;
      
      tabElement.appendChild(favicon);
      tabElement.appendChild(title);
      tabList.appendChild(tabElement);
    });
    
    groupHeader.appendChild(titleInput);
    groupHeader.appendChild(colorPicker);
    groupElement.appendChild(groupHeader);
    groupElement.appendChild(tabList);
    groupList.appendChild(groupElement);
    
    // 更新标签组标题和颜色
    titleInput.addEventListener('change', async () => {
      group.title = titleInput.value;
      await createChromeTabGroup(group);
    });
    
    colorPicker.addEventListener('change', async () => {
      const colorMap = {
        '#666666': 'grey',
        '#1E88E5': 'blue',
        '#43A047': 'green',
        '#E53935': 'red',
        '#FB8C00': 'orange',
        '#8E24AA': 'purple',
        '#FFD700': 'yellow',
        '#FF69B4': 'pink'
      };
      group.color = colorMap[colorPicker.value] || 'grey';
      await createChromeTabGroup(group);
    });
  });
}

// 取消所有标签组
async function ungroupAllTabs() {
  const tabs = await getCurrentWindowTabs();
  const tabIds = tabs.map(tab => tab.id);
  await chrome.tabs.ungroup(tabIds);
  updateUI([]);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  const groupButton = document.getElementById('groupTabs');
  const ungroupButton = document.getElementById('ungroupTabs');
  
  groupButton.addEventListener('click', async () => {
    const tabs = await getCurrentWindowTabs();
    const groups = await groupTabs(tabs);
    updateUI(groups);
    
    // 创建Chrome标签组
    for (const group of groups) {
      await createChromeTabGroup(group);
    }
  });

  ungroupButton.addEventListener('click', async () => {
    await ungroupAllTabs();
  });
});