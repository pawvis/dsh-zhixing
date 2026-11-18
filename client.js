window.__ModuleLoader__.load({
  id: 'dsh-zhixing',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const API = '/api/zhixing'
    // 后端只有在 ZHIXING_DEBUG=1 时才注册 /debug/*；前端按同一个开关隐藏入口。
    let DEBUG_ENABLED = false
    const PANEL_ID = 'zhixing'
    const CYCLES = ['年', '季度', '月', '周']
    const CYCLE_RANK = { 周: 1, 月: 2, 季度: 3, 年: 4 }
    const CHILD_CYCLE = { 年: '季度', 季度: '月', 月: '周' }
    const PARENT_CYCLE = { 周: '月', 月: '季度', 季度: '年' }
    // 与 lib/levers.js 的 LEVER_MIN / LEVER_MAX 保持一致。
    const LEVER_MIN = 2
    const LEVER_MAX = 4
    // 城市 → 时区。插件里所有日期和时间都以设置里的城市时区为准。
    const CITY_TZ = {
      北京: 'Asia/Shanghai', 上海: 'Asia/Shanghai', 广州: 'Asia/Shanghai', 深圳: 'Asia/Shanghai',
      成都: 'Asia/Shanghai', 杭州: 'Asia/Shanghai', 南京: 'Asia/Shanghai', 武汉: 'Asia/Shanghai',
      西安: 'Asia/Shanghai', 重庆: 'Asia/Shanghai', 天津: 'Asia/Shanghai', 苏州: 'Asia/Shanghai',
      长沙: 'Asia/Shanghai', 郑州: 'Asia/Shanghai', 青岛: 'Asia/Shanghai', 沈阳: 'Asia/Shanghai',
      大连: 'Asia/Shanghai', 厦门: 'Asia/Shanghai', 福州: 'Asia/Shanghai', 济南: 'Asia/Shanghai',
      合肥: 'Asia/Shanghai', 昆明: 'Asia/Shanghai', 南宁: 'Asia/Shanghai', 贵阳: 'Asia/Shanghai',
      太原: 'Asia/Shanghai', 石家庄: 'Asia/Shanghai', 哈尔滨: 'Asia/Shanghai', 长春: 'Asia/Shanghai',
      南昌: 'Asia/Shanghai', 海口: 'Asia/Shanghai', 兰州: 'Asia/Shanghai', 西宁: 'Asia/Shanghai',
      银川: 'Asia/Shanghai', 乌鲁木齐: 'Asia/Shanghai', 拉萨: 'Asia/Shanghai', 呼和浩特: 'Asia/Shanghai',
      香港: 'Asia/Hong_Kong', 澳门: 'Asia/Macau', 台北: 'Asia/Taipei',
      东京: 'Asia/Tokyo', 大阪: 'Asia/Tokyo', 首尔: 'Asia/Seoul', 新加坡: 'Asia/Singapore',
      曼谷: 'Asia/Bangkok', 雅加达: 'Asia/Jakarta', 马尼拉: 'Asia/Manila', 吉隆坡: 'Asia/Kuala_Lumpur',
      新德里: 'Asia/Kolkata', 孟买: 'Asia/Kolkata', 迪拜: 'Asia/Dubai', 莫斯科: 'Europe/Moscow',
      伦敦: 'Europe/London', 巴黎: 'Europe/Paris', 柏林: 'Europe/Berlin', 罗马: 'Europe/Rome',
      马德里: 'Europe/Madrid', 阿姆斯特丹: 'Europe/Amsterdam', 苏黎世: 'Europe/Zurich',
      纽约: 'America/New_York', 华盛顿: 'America/New_York', 波士顿: 'America/New_York',
      洛杉矶: 'America/Los_Angeles', 旧金山: 'America/Los_Angeles', 西雅图: 'America/Los_Angeles',
      芝加哥: 'America/Chicago', 多伦多: 'America/Toronto', 温哥华: 'America/Vancouver',
      墨西哥城: 'America/Mexico_City', 圣保罗: 'America/Sao_Paulo',
      悉尼: 'Australia/Sydney', 墨尔本: 'Australia/Melbourne', 珀斯: 'Australia/Perth',
      奥克兰: 'Pacific/Auckland',
    }
    const CITY_NAMES = Object.keys(CITY_TZ)
    let ACTIVE_TZ = ''
    function systemTz() {
      try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
    }
    function isValidTz(tz) {
      if (!tz) return false
      try { new Intl.DateTimeFormat('en-US', { timeZone: String(tz) }); return true } catch { return false }
    }
    function setActiveTz(tz) {
      ACTIVE_TZ = isValidTz(tz) ? String(tz) : ''
    }
    function currentTz() {
      return ACTIVE_TZ || systemTz()
    }
    /** 城市名 → IANA 时区；支持「成都市」这种带后缀的输入。 */
    function tzForRegion(region) {
      const text = String(region ?? '').trim()
      if (!text) return ''
      if (CITY_TZ[text]) return CITY_TZ[text]
      const found = CITY_NAMES.filter((name) => text.includes(name)).sort((a, b) => b.length - a.length)[0]
      return found ? CITY_TZ[found] : ''
    }
    function zoneParts(date = new Date(), tz = currentTz()) {
      try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: tz, hourCycle: 'h23',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        })
        const out = {}
        for (const part of formatter.formatToParts(date)) if (part.type !== 'literal') out[part.type] = part.value
        return { year: Number(out.year), month: Number(out.month), day: Number(out.day), hour: Number(out.hour), minute: Number(out.minute), second: Number(out.second) }
      } catch {
        return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds() }
      }
    }
    /** 目标时区的「现在」，用本地 Date 承载，getHours/getDate 即为当地时间。 */
    function nowInZone() {
      const parts = zoneParts()
      return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    }
    function formatDateTimeInZone(date = new Date(), tz = currentTz(), withSeconds = true) {
      const parts = zoneParts(date, tz)
      const pad = (n) => String(n).padStart(2, '0')
      return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}${withSeconds ? `:${pad(parts.second)}` : ''}`
    }
    function formatDateInZone(date = new Date(), tz = currentTz()) {
      try {
        return new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: 'long', day: 'numeric', weekday: 'long' }).format(date)
      } catch {
        return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${date.toLocaleDateString('zh-CN', { weekday: 'long' })}`
      }
    }
    function tzLongName(tz = currentTz()) {
      try {
        return new Intl.DateTimeFormat('zh-CN', { timeZone: tz, timeZoneName: 'long' }).formatToParts(new Date()).find((item) => item.type === 'timeZoneName')?.value || tz
      } catch { return tz }
    }
    // 内容库：与 docs/feature-c-20261114/内容库.json 逐字一致（脚本内联，不手抄）
    const LUCKY_DATA =     {
     "meals": {
      "breakfast": {
       "label": "早饭",
       "range": "05:00–10:00",
       "items": [
        {
         "n": "豆浆油条",
         "e": "🥖",
         "t": "经典搭配，热乎乎开启一天",
         "k": [
          "q"
         ]
        },
        {
         "n": "煎饼果子",
         "e": "🌯",
         "t": "加个蛋，再来根脆",
         "k": [
          "q"
         ]
        },
        {
         "n": "小笼包配粥",
         "e": "🥟",
         "t": "慢慢吃，不赶时间",
         "k": [
          "l"
         ]
        },
        {
         "n": "咸豆花",
         "e": "🥣",
         "t": "软软的，对肠胃友好",
         "k": [
          "l"
         ]
        },
        {
         "n": "鸡蛋灌饼",
         "e": "🫓",
         "t": "边走边吃也行",
         "k": [
          "q"
         ]
        },
        {
         "n": "燕麦牛奶配香蕉",
         "e": "🥛",
         "t": "五分钟搞定，不耽误开工",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "全麦三明治",
         "e": "🥪",
         "t": "蛋白质加满，上午不容易饿",
         "k": [
          "q"
         ]
        },
        {
         "n": "皮蛋瘦肉粥",
         "e": "🍲",
         "t": "暖胃，适合没睡够的早晨",
         "k": [
          "l"
         ]
        },
        {
         "n": "肉夹馍",
         "e": "🥙",
         "t": "碳水快乐，今天值得",
         "k": [
          "h"
         ]
        },
        {
         "n": "热干面",
         "e": "🍜",
         "t": "芝麻酱管够",
         "k": [
          "h"
         ]
        },
        {
         "n": "手抓饼加蛋",
         "e": "🫓",
         "t": "酥脆有层次",
         "k": [
          "q"
         ]
        },
        {
         "n": "包子配豆浆",
         "e": "🥟",
         "t": "朴素但永远不出错",
         "k": [
          "q"
         ]
        },
        {
         "n": "水果酸奶杯",
         "e": "🍓",
         "t": "清爽，当作给自己的小奖励",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "红糖馒头配小米粥",
         "e": "🍚",
         "t": "软糯香甜，一整天都温柔",
         "k": [
          "l"
         ]
        }
       ]
      },
      "lunch": {
       "label": "午饭",
       "range": "10:00–14:00",
       "items": [
        {
         "n": "黄焖鸡米饭",
         "e": "🍗",
         "t": "下饭担当，吃完不后悔",
         "k": [
          "h"
         ]
        },
        {
         "n": "牛肉面",
         "e": "🍜",
         "t": "一碗热汤面，上午的疲惫都散了",
         "k": [
          "h"
         ]
        },
        {
         "n": "麻辣烫",
         "e": "🌶️",
         "t": "想吃什么夹什么，自由",
         "k": [
          "h"
         ]
        },
        {
         "n": "番茄鸡蛋盖饭",
         "e": "🍅",
         "t": "永远不会错的选择",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "日式照烧鸡腿饭",
         "e": "🍱",
         "t": "甜咸适中，吃着安心",
         "k": [
          "q"
         ]
        },
        {
         "n": "轻食沙拉加鸡胸",
         "e": "🥗",
         "t": "给自己的一点轻盈",
         "k": [
          "l"
         ]
        },
        {
         "n": "猪脚饭",
         "e": "🍖",
         "t": "今天值得一份扎实的",
         "k": [
          "h"
         ]
        },
        {
         "n": "兰州拉面",
         "e": "🍜",
         "t": "汤清面劲，加一份牛肉",
         "k": [
          "h"
         ]
        },
        {
         "n": "酸菜鱼",
         "e": "🐟",
         "t": "酸爽开胃，有人一起更好",
         "k": [
          "h"
         ]
        },
        {
         "n": "饺子",
         "e": "🥟",
         "t": "最治愈的碳水，没有之一",
         "k": [
          "q"
         ]
        },
        {
         "n": "卤肉饭",
         "e": "🍛",
         "t": "浇汁拌饭，幸福",
         "k": [
          "h"
         ]
        },
        {
         "n": "粤式烧腊饭",
         "e": "🍗",
         "t": "叉烧加溏心蛋",
         "k": [
          "h"
         ]
        },
        {
         "n": "家常小炒配米饭",
         "e": "🍚",
         "t": "有锅气，有人间烟火",
         "k": []
        },
        {
         "n": "寿司拼盘",
         "e": "🍣",
         "t": "精致一点，奖励上午的自己",
         "k": [
          "l"
         ]
        },
        {
         "n": "越南河粉",
         "e": "🍲",
         "t": "清清爽爽，汤很鲜",
         "k": [
          "l"
         ]
        },
        {
         "n": "鸡公煲",
         "e": "🍲",
         "t": "辣得过瘾，吃完满血复活",
         "k": [
          "h"
         ]
        }
       ]
      },
      "tea": {
       "label": "下午茶",
       "range": "14:00–17:00",
       "items": [
        {
         "n": "美式加一块蛋糕",
         "e": "☕",
         "t": "下午三点，给自己一个停顿",
         "k": [
          "q"
         ]
        },
        {
         "n": "奶茶，少糖",
         "e": "🧋",
         "t": "快乐不需要理由",
         "k": [
          "q"
         ]
        },
        {
         "n": "水果切盘",
         "e": "🍉",
         "t": "清爽解腻，补点维生素",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "酸奶加坚果",
         "e": "🥜",
         "t": "轻负担，撑到晚饭",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "抹茶拿铁",
         "e": "🍵",
         "t": "微苦回甘，提神又温柔",
         "k": [
          "l"
         ]
        },
        {
         "n": "小面包配热牛奶",
         "e": "🥐",
         "t": "暖暖的，下午不犯困",
         "k": [
          "q"
         ]
        },
        {
         "n": "鲜榨橙汁",
         "e": "🍊",
         "t": "维C补给，眼睛都亮了",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "红豆双皮奶",
         "e": "🍮",
         "t": "甜而不腻，软软的幸福",
         "k": [
          "l"
         ]
        },
        {
         "n": "鸡蛋仔",
         "e": "🥚",
         "t": "边走边吃，边聊边笑",
         "k": [
          "q"
         ]
        },
        {
         "n": "烤红薯",
         "e": "🍠",
         "t": "朴素的甜，最暖胃",
         "k": [
          "l"
         ]
        },
        {
         "n": "一小把坚果加黑巧",
         "e": "🍫",
         "t": "大脑的燃料，别吃太多哦",
         "k": [
          "q"
         ]
        },
        {
         "n": "手冲咖啡",
         "e": "☕",
         "t": "慢慢冲，慢慢喝，慢慢想",
         "k": [
          "l"
         ]
        }
       ]
      },
      "dinner": {
       "label": "晚饭",
       "range": "17:00–21:00",
       "items": [
        {
         "n": "火锅",
         "e": "🍲",
         "t": "一天的辛苦，值得被热气包住",
         "k": [
          "h"
         ]
        },
        {
         "n": "番茄牛腩饭",
         "e": "🍅",
         "t": "慢炖的温柔，吃完整个人都软了",
         "k": [
          "h"
         ]
        },
        {
         "n": "清蒸鱼配青菜",
         "e": "🐟",
         "t": "轻盈收尾，今晚好睡",
         "k": [
          "l"
         ]
        },
        {
         "n": "烤肉",
         "e": "🥩",
         "t": "滋滋作响的快乐",
         "k": [
          "h"
         ]
        },
        {
         "n": "家里煮碗面",
         "e": "🍜",
         "t": "加个蛋，再来点青菜，最治愈",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "小炒黄牛肉",
         "e": "🥘",
         "t": "下饭神器，来两碗饭",
         "k": [
          "h"
         ]
        },
        {
         "n": "麻婆豆腐盖饭",
         "e": "🌶️",
         "t": "麻辣鲜香，唤醒味蕾",
         "k": [
          "h"
         ]
        },
        {
         "n": "砂锅粥加小菜",
         "e": "🍲",
         "t": "温和，适合累了的晚上",
         "k": [
          "l"
         ]
        },
        {
         "n": "咖喱鸡肉饭",
         "e": "🍛",
         "t": "香浓顺滑，一勺下去全是安慰",
         "k": []
        },
        {
         "n": "饺子配小菜",
         "e": "🥟",
         "t": "热腾腾，家的味道",
         "k": [
          "q"
         ]
        },
        {
         "n": "寿喜烧",
         "e": "🍳",
         "t": "甜咸交织，今晚犒劳自己",
         "k": []
        },
        {
         "n": "菌菇汤配杂粮饭",
         "e": "🍄",
         "t": "鲜得掉眉毛，又不会负担",
         "k": [
          "l"
         ]
        },
        {
         "n": "披萨加沙拉",
         "e": "🍕",
         "t": "周末感提前到账",
         "k": []
        },
        {
         "n": "炒饭加蛋",
         "e": "🍳",
         "t": "最朴素的快乐，十分钟上桌",
         "k": [
          "q"
         ]
        },
        {
         "n": "烧烤",
         "e": "🍢",
         "t": "串起来的都是快乐",
         "k": [
          "h"
         ]
        }
       ]
      },
      "night": {
       "label": "夜宵",
       "range": "21:00–05:00",
       "items": [
        {
         "n": "热牛奶加饼干",
         "e": "🥛",
         "t": "吃完好入睡",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "一碗小馄饨",
         "e": "🥟",
         "t": "暖暖的，不负担",
         "k": [
          "l"
         ]
        },
        {
         "n": "泡面加蛋",
         "e": "🍜",
         "t": "偶尔一次，没人怪你",
         "k": [
          "q",
          "h"
         ]
        },
        {
         "n": "烤红薯",
         "e": "🍠",
         "t": "暖手又暖胃",
         "k": [
          "l"
         ]
        },
        {
         "n": "水果拼盘",
         "e": "🍎",
         "t": "清爽收尾",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "银耳莲子羹",
         "e": "🥣",
         "t": "润润的，晚安",
         "k": [
          "l"
         ]
        },
        {
         "n": "烧烤小串",
         "e": "🍢",
         "t": "难得放松，别太多",
         "k": [
          "h"
         ]
        },
        {
         "n": "酸奶加燕麦",
         "e": "🥣",
         "t": "轻负担，睡得香",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "一杯温蜂蜜水",
         "e": "🍯",
         "t": "什么都不吃也是一种选择",
         "k": [
          "l",
          "q"
         ]
        },
        {
         "n": "关东煮",
         "e": "🍢",
         "t": "热汤热串，便利店的温柔",
         "k": [
          "q"
         ]
        }
       ]
      }
     },
     "fortunes": [
      {
       "lv": "上上签",
       "p": [
        "春风得意马蹄轻",
        "一路繁花送你行"
       ],
       "t": "今天做的事，大多比你想的顺。放心去推进那件拖了很久的事。",
       "yi": [
        "推进拖延的事",
        "写日报"
       ],
       "c": "暖橙",
       "n": "7"
      },
      {
       "lv": "上上签",
       "p": [
        "云开见日万山青",
        "心里石头已落平"
       ],
       "t": "你担心的那件事，没有想象中难。先动手，剩下的交给时间。",
       "yi": [
        "开口沟通",
        "先做最难的"
       ],
       "c": "天蓝",
       "n": "3"
      },
      {
       "lv": "上吉签",
       "p": [
        "长风破浪会有时",
        "小步慢行亦不迟"
       ],
       "t": "不用一口气做完，把今天的第一件小事做好，就是赢。",
       "yi": [
        "先做一件最小的事",
        "列清单"
       ],
       "c": "松绿",
       "n": "5"
      },
      {
       "lv": "上吉签",
       "p": [
        "月下花开静有声",
        "不争朝夕自分明"
       ],
       "t": "你的努力有人看见，只是还没轮到发光。继续就好。",
       "yi": [
        "写下今天的成果",
        "整理笔记"
       ],
       "c": "米白",
       "n": "8"
      },
      {
       "lv": "上上签",
       "p": [
        "东风吹散一冬寒",
        "好事连连到眼前"
       ],
       "t": "今天适合开始新的东西：新想法、新计划、新的一页。",
       "yi": [
        "开新任务",
        "约人聊聊"
       ],
       "c": "樱粉",
       "n": "2"
      },
      {
       "lv": "中吉签",
       "p": [
        "慢火煨汤味自浓",
        "不急不躁事成功"
       ],
       "t": "节奏慢一点反而更稳。给自己留一段完整的专注时间。",
       "yi": [
        "关掉通知专注一小时",
        "喝足水"
       ],
       "c": "琥珀",
       "n": "6"
      },
      {
       "lv": "上吉签",
       "p": [
        "山重水复疑无路",
        "转角灯火是故人"
       ],
       "t": "卡住的地方，今天会有转机。换个角度，或者问问身边的人。",
       "yi": [
        "请教同事",
        "换个思路"
       ],
       "c": "湖蓝",
       "n": "9"
      },
      {
       "lv": "中吉签",
       "p": [
        "小舟轻载一江月",
        "不问前程自有风"
       ],
       "t": "不用想太远，把眼前这一格走好，路会自己出现。",
       "yi": [
        "只看今天",
        "早点收工"
       ],
       "c": "月白",
       "n": "1"
      },
      {
       "lv": "上上签",
       "p": [
        "新叶初成枝上春",
        "一腔热意总逢人"
       ],
       "t": "你的认真会被好好接住。今天适合展示成果、说出想法。",
       "yi": [
        "汇报进展",
        "分享想法"
       ],
       "c": "嫩绿",
       "n": "4"
      },
      {
       "lv": "小吉签",
       "p": [
        "细雨润物不惊人",
        "日积月累自成林"
       ],
       "t": "今天可能平平淡淡，但每一点积累都算数，别小看自己。",
       "yi": [
        "复盘一件小事",
        "给自己倒杯热水"
       ],
       "c": "浅灰蓝",
       "n": "6"
      },
      {
       "lv": "上吉签",
       "p": [
        "灯下一盏心自安",
        "万事从容次第看"
       ],
       "t": "事情多也不乱：排好顺序，一件一件来，你完全应付得来。",
       "yi": [
        "排优先级",
        "做完打个勾"
       ],
       "c": "暖黄",
       "n": "3"
      },
      {
       "lv": "中吉签",
       "p": [
        "晴窗一卷书声软",
        "静处生光日日新"
       ],
       "t": "今天适合学点新东西，哪怕只有十分钟，都会有回报。",
       "yi": [
        "读一篇好文章",
        "记一条笔记"
       ],
       "c": "墨绿",
       "n": "8"
      },
      {
       "lv": "上上签",
       "p": [
        "千帆过尽见阳光",
        "风过无痕笑意长"
       ],
       "t": "辛苦的一段快要过去了。今天，对自己好一点。",
       "yi": [
        "犒劳自己",
        "早点休息"
       ],
       "c": "金黄",
       "n": "7"
      },
      {
       "lv": "上吉签",
       "p": [
        "一路向前不回头",
        "自有清风伴你游"
       ],
       "t": "你比自己以为的更有能力。想做就做，别等准备好。",
       "yi": [
        "迈出第一步",
        "相信直觉"
       ],
       "c": "天青",
       "n": "1"
      },
      {
       "lv": "小吉签",
       "p": [
        "寻常日子也生花",
        "一杯清茶一盏茶"
       ],
       "t": "把日子过得安稳，本身就是成就。今天适合慢慢来。",
       "yi": [
        "散步十分钟",
        "吃顿好饭"
       ],
       "c": "茶褐",
       "n": "2"
      },
      {
       "lv": "中吉签",
       "p": [
        "柳暗花明又一村",
        "笑看浮云自在人"
       ],
       "t": "今天会遇到一个小惊喜，可能是一句夸奖，也可能是顺手解决的问题。",
       "yi": [
        "保持好奇",
        "多说谢谢"
       ],
       "c": "藕荷",
       "n": "5"
      },
      {
       "lv": "上上签",
       "p": [
        "朝霞满纸写新篇",
        "每一笔都向光明"
       ],
       "t": "今天写下的每一行，都会成为将来的底气。认真记录自己。",
       "yi": [
        "写日报",
        "更新目标进度"
       ],
       "c": "朝红",
       "n": "9"
      },
      {
       "lv": "上吉签",
       "p": [
        "溪水潺潺绕石过",
        "遇阻不惊自成河"
       ],
       "t": "遇到阻碍别硬碰，绕一下，水一样地流过去。",
       "yi": [
        "换条路走",
        "向人求助"
       ],
       "c": "溪蓝",
       "n": "4"
      },
      {
       "lv": "中吉签",
       "p": [
        "晚风轻拂旧衣裳",
        "心里有光不慌张"
       ],
       "t": "忙完这一阵就好了。再坚持一小会儿，今晚值得被好好对待。",
       "yi": [
        "准时下班",
        "散步回家"
       ],
       "c": "暮紫",
       "n": "6"
      },
      {
       "lv": "小吉签",
       "p": [
        "一步一印踏青苔",
        "不赶不慌慢慢来"
       ],
       "t": "今天不必证明什么。做完该做的，剩下的时间属于你。",
       "yi": [
        "留白",
        "听首喜欢的歌"
       ],
       "c": "苔绿",
       "n": "3"
      }
     ],
     "tarot": [
      {
       "n": "愚者",
       "r": "0",
       "e": "🎒",
       "kw": "新开始·轻装·好奇",
       "t": "今天适合尝试没做过的事。不用准备到完美，迈出第一步就行。",
       "yi": "从最小的一步开始"
      },
      {
       "n": "魔术师",
       "r": "I",
       "e": "🪄",
       "kw": "行动·资源·专注",
       "t": "你手里的工具比想象中多。把想法落成具体动作，今天效率很高。",
       "yi": "把想法写成待办"
      },
      {
       "n": "女祭司",
       "r": "II",
       "e": "🌙",
       "kw": "直觉·安静·倾听",
       "t": "答案可能不在会议里，而在安静的十分钟里。相信第一直觉。",
       "yi": "留一段独处思考的时间"
      },
      {
       "n": "皇后",
       "r": "III",
       "e": "🌿",
       "kw": "滋养·创造·丰盛",
       "t": "今天适合照顾好自己和身边的人，创意也特别丰盛。",
       "yi": "吃顿好饭再开工"
      },
      {
       "n": "皇帝",
       "r": "IV",
       "e": "🏔️",
       "kw": "秩序·掌控·稳固",
       "t": "把事情排出结构：先列框架再填内容，你会有掌控感。",
       "yi": "先排优先级"
      },
      {
       "n": "教皇",
       "r": "V",
       "e": "📜",
       "kw": "经验·学习·请教",
       "t": "身边有人能给你好建议。今天适合请教前辈，或回看自己的经验。",
       "yi": "找人聊十分钟"
      },
      {
       "n": "恋人",
       "r": "VI",
       "e": "💞",
       "kw": "选择·合作·共鸣",
       "t": "会遇到默契的人和事。做选择时，听听自己真正想要什么。",
       "yi": "选一件你真心想做的"
      },
      {
       "n": "战车",
       "r": "VII",
       "e": "🛡️",
       "kw": "推进·胜利·意志",
       "t": "目标清晰就一路向前。今天适合啃硬骨头，会有明显进展。",
       "yi": "攻克拖延最久的事"
      },
      {
       "n": "力量",
       "r": "VIII",
       "e": "🦁",
       "kw": "温柔·耐心·韧性",
       "t": "真正的力量是耐心。今天对自己和他人都温柔一点，反而更有效。",
       "yi": "慢慢来，别硬撑"
      },
      {
       "n": "隐者",
       "r": "IX",
       "e": "🏮",
       "kw": "复盘·沉淀·方向",
       "t": "适合独自梳理。回头看看这段时间的收获，方向会更清楚。",
       "yi": "写一篇复盘"
      },
      {
       "n": "命运之轮",
       "r": "X",
       "e": "🎡",
       "kw": "转机·时机·流动",
       "t": "风向在变好。留意突然出现的机会，别急着拒绝。",
       "yi": "对新机会说「先聊聊」"
      },
      {
       "n": "正义",
       "r": "XI",
       "e": "⚖️",
       "kw": "公平·清晰·平衡",
       "t": "今天适合把事情说清楚、算明白，该争取的大方争取。",
       "yi": "把边界说清楚"
      },
      {
       "n": "倒吊人",
       "r": "XII",
       "e": "🙃",
       "kw": "换角度·暂停·领悟",
       "t": "卡住时换个角度看，停一停反而看得更清楚。",
       "yi": "换个思路再试"
      },
      {
       "n": "死神",
       "r": "XIII",
       "e": "🦋",
       "kw": "告别·新生·蜕变",
       "t": "有些旧习惯该放下了。结束一件事，是为新的开始腾出位置。",
       "yi": "清理一项不再需要的事"
      },
      {
       "n": "节制",
       "r": "XIV",
       "e": "🍵",
       "kw": "平衡·节奏·调和",
       "t": "工作和生活可以调得更舒服。今天适合稳稳推进，不赶不拖。",
       "yi": "给自己留午休"
      },
      {
       "n": "恶魔",
       "r": "XV",
       "e": "🔗",
       "kw": "看清·放下·自由",
       "t": "看清是什么在拖着你，认出来，你就已经有选择了。",
       "yi": "放下一个「必须」"
      },
      {
       "n": "高塔",
       "r": "XVI",
       "e": "⚡",
       "kw": "重启·突破·释放",
       "t": "如果有突发状况，别慌，它是帮你清掉不稳的东西，之后更扎实。",
       "yi": "遇事先深呼吸"
      },
      {
       "n": "星星",
       "r": "XVII",
       "e": "⭐",
       "kw": "希望·治愈·被看见",
       "t": "辛苦会被看见。今天适合许一个小愿望，并为它做点什么。",
       "yi": "写下一个小目标"
      },
      {
       "n": "月亮",
       "r": "XVIII",
       "e": "🌕",
       "kw": "直觉·情绪·模糊",
       "t": "感觉有点不确定也没关系，先照顾情绪，细节明天会更清楚。",
       "yi": "不做重大决定，先休息"
      },
      {
       "n": "太阳",
       "r": "XIX",
       "e": "☀️",
       "kw": "成功·快乐·活力",
       "t": "今天状态在线，做什么都顺手。适合展示成果，开心就大方笑。",
       "yi": "主动分享你的成果"
      },
      {
       "n": "审判",
       "r": "XX",
       "e": "🎺",
       "kw": "觉醒·回应·总结",
       "t": "该做个总结的时候。回顾所做的，认可自己，然后轻松出发。",
       "yi": "写今天的日报"
      },
      {
       "n": "世界",
       "r": "XXI",
       "e": "🌍",
       "kw": "完成·圆满·整合",
       "t": "一个阶段圆满收尾。今天适合交付、收口，也适合庆祝一下。",
       "yi": "把手上的事收个尾"
      }
     ],
     "signs": [
      {
       "n": "白羊座",
       "s": "♈",
       "r": "3.21–4.19",
       "k": "行动派"
      },
      {
       "n": "金牛座",
       "s": "♉",
       "r": "4.20–5.20",
       "k": "稳扎稳打"
      },
      {
       "n": "双子座",
       "s": "♊",
       "r": "5.21–6.21",
       "k": "点子多"
      },
      {
       "n": "巨蟹座",
       "s": "♋",
       "r": "6.22–7.22",
       "k": "细腻体贴"
      },
      {
       "n": "狮子座",
       "s": "♌",
       "r": "7.23–8.22",
       "k": "自带光芒"
      },
      {
       "n": "处女座",
       "s": "♍",
       "r": "8.23–9.22",
       "k": "追求完美"
      },
      {
       "n": "天秤座",
       "s": "♎",
       "r": "9.23–10.23",
       "k": "平衡高手"
      },
      {
       "n": "天蝎座",
       "s": "♏",
       "r": "10.24–11.22",
       "k": "专注深入"
      },
      {
       "n": "射手座",
       "s": "♐",
       "r": "11.23–12.21",
       "k": "自由乐观"
      },
      {
       "n": "摩羯座",
       "s": "♑",
       "r": "12.22–1.19",
       "k": "踏实靠谱"
      },
      {
       "n": "水瓶座",
       "s": "♒",
       "r": "1.20–2.18",
       "k": "脑洞大开"
      },
      {
       "n": "双鱼座",
       "s": "♓",
       "r": "2.19–3.20",
       "k": "温柔感性"
      }
     ],
     "horo": {
      "sum": [
       "今天整体节奏顺，适合把手头的事稳稳推进。",
       "灵感在线，有想法就记下来，会派上用场。",
       "人缘不错，主动说一句话就能换来帮助。",
       "适合收尾和整理，做完一件就是赚到一件。",
       "会有小惊喜，可能是一句夸奖或一个好消息。",
       "状态平稳，不赶不拖，今天靠积累拿分。",
       "适合学点新东西，十分钟也算数。",
       "精力充沛，抓紧时间做最重要的那件事。",
       "遇到小卡点别慌，换个角度就通了。",
       "你的努力正在被看见，保持节奏就好。"
      ],
      "work": [
       "先做最重要的一件，其余顺其自然。",
       "开会时大胆说出想法，会被认真对待。",
       "适合整理文档、复盘和写日报。",
       "遇到难题先问一句，可能比想的容易解决。",
       "把大任务拆成三小步，今天只做第一步。",
       "适合推进需要多人配合的事情。",
       "专注一小时，关掉通知，效率翻倍。",
       "适合汇报进展，让别人知道你做了什么。",
       "先处理拖延的事，后面一路轻松。",
       "用清单收口，打勾的感觉很好。"
      ],
      "mood": [
       "心情偏轻快，记得多喝水。",
       "偶尔小焦虑，深呼吸三次就好。",
       "适合和朋友聊两句，开心会翻倍。",
       "给自己十分钟散步时间，会更有劲。",
       "今天容易被小事感动，也容易被小事治愈。",
       "如果累了就早点收工，别硬撑。",
       "适合听一首喜欢的歌，心情加分。",
       "心里踏实，做什么都从容。",
       "对自己多一点肯定，你比想象中做得好。",
       "晚上给自己留点完整的时间。"
      ]
     }
    }


    const CSS = `
      .wb-root{--wb-bg:#F7F7F5;--wb-card:#FFFFFF;--wb-text:#1F2937;--wb-muted:#6B7280;--wb-accent:#2563EB;--wb-border:#E5E7EB;--wb-shadow:0 1px 2px rgba(15,23,42,.06),0 4px 16px rgba(15,23,42,.06);--wb-primary:#2563EB;--wb-primary-soft:#EFF6FF;--wb-ai:#6D28D9;--wb-ai-hover:#5B21B6;--wb-ai-soft:#F3EEFF;--wb-ai-line:#C4B5FD;--wb-text-2:#4B5563;--wb-text-3:#6B7280;--wb-surface-2:#F3F4F6;--wb-surface-3:#E5E7EB;--wb-border-strong:#D1D5DB;--wb-danger:#DC2626;--wb-r-sm:6px;--wb-r-md:10px;--wb-r-lg:14px;--wb-fs-xs:12px;--wb-fs-sm:13px;--wb-fs-md:14px;--wb-fs-lg:16px;--wb-fs-xl:20px;height:100%;min-height:0;display:flex;flex-direction:column;background:var(--wb-bg);color:var(--wb-text);font:13px/1.6 -apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif}
      .wb-root[data-wb-theme="dark"]{--wb-bg:#141414;--wb-card:#1C1C1E;--wb-text:#EDEDED;--wb-muted:#A1A1AA;--wb-accent:#2563EB;--wb-border:rgba(255,255,255,.10);--wb-shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);--wb-primary-soft:rgba(37,99,235,.20);--wb-ai-soft:rgba(167,139,250,.14);--wb-ai-line:#7C3AED;--wb-text-2:#D4D4D8;--wb-text-3:#A1A1AA;--wb-surface-2:#26262A;--wb-surface-3:#34343A;--wb-border-strong:rgba(255,255,255,.18);--wb-danger:#F87171}
      .wb-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--wb-border);flex:0 0 auto;background:var(--wb-card)}
      .wb-title{font-size:15px;font-weight:650;letter-spacing:.01em;white-space:nowrap}
      .wb-tabs{display:flex;gap:4px;margin-left:8px;background:rgba(127,127,127,.08);padding:3px;border-radius:10px}
      .wb-tab{border:0;background:transparent;color:var(--wb-muted);font:inherit;padding:4px 12px;border-radius:8px;cursor:pointer;white-space:nowrap}
      .wb-tab.active{background:var(--wb-card);color:var(--wb-text);box-shadow:0 1px 2px rgba(0,0,0,.12)}
      @media(max-width:700px){
        .wb-head{gap:8px;padding:10px 14px}
        .wb-tabs{margin-left:4px;gap:2px;padding:2px}
        .wb-tab{padding:4px 7px;font-size:12px}
        .wb-head > .wb-small{white-space:nowrap;font-size:11px}
        .wb-model-btn{max-width:min(260px,38vw)}
      }
      .wb-spacer{flex:1 1 auto}
      .wb-btn{height:32px;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 12px;border-radius:var(--wb-r-md);border:1px solid var(--wb-border-strong);background:var(--wb-card);color:var(--wb-text);font:inherit;font-weight:500;white-space:nowrap;flex:none;cursor:pointer}
      .wb-btn:hover{border-color:var(--wb-accent)}
      .wb-btn:disabled,.wb-icon-btn:disabled{opacity:.5;cursor:not-allowed}
      .wb-btn.sm{height:28px;padding:0 10px;font-size:var(--wb-fs-xs)}
      .wb-btn.primary{background:var(--wb-primary);border-color:var(--wb-primary);color:#fff}
      .wb-btn.primary:hover{background:#1D4ED8}
      .wb-btn.ai{background:var(--wb-ai);border-color:var(--wb-ai);color:#fff}
      .wb-btn.ai:hover{background:var(--wb-ai-hover)}
      .wb-btn.ai:disabled,.wb-btn.primary:disabled{opacity:.5;cursor:not-allowed}
      .wb-btn.ai-2{background:transparent;border-color:var(--wb-ai-line);color:var(--wb-ai)}
      .wb-ai-btn{background:var(--wb-ai);border-color:var(--wb-ai);color:#fff;display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:var(--wb-r-md);font:inherit;font-weight:500;cursor:pointer}
      .wb-ai-btn:hover{background:var(--wb-ai-hover)}
      .wb-ai-btn:disabled{opacity:.5;cursor:not-allowed}
      .wb-btn.ai-2:hover{background:var(--wb-ai-soft)}
      .wb-btn.danger{color:var(--wb-danger);border-color:transparent;background:transparent}
      .wb-btn.danger:hover{background:color-mix(in srgb,var(--wb-danger) 10%,transparent)}
      .wb-btn.danger-solid{background:var(--wb-danger);border-color:var(--wb-danger);color:#fff}
      .wb-btn.ghost{border-color:transparent;background:transparent;color:var(--wb-text-2)}
      .wb-btn.ghost:hover{background:var(--wb-surface-2);color:var(--wb-text)}
      .wb-ai-tag{display:inline-flex;align-items:center;gap:3px;height:22px;padding:0 8px;border-radius:999px;background:var(--wb-ai-soft);color:var(--wb-ai);font-size:var(--wb-fs-xs);font-weight:600;border:1px solid var(--wb-ai-line);white-space:nowrap}
      .wb-icon-btn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--wb-text-3);border-radius:var(--wb-r-sm);cursor:pointer;font-size:14px;line-height:1;padding:0}
      .wb-icon-btn:hover{background:var(--wb-surface-2);color:var(--wb-text)}
      .wb-seg{display:flex;gap:2px;background:var(--wb-surface-2);padding:3px;border-radius:var(--wb-r-md);align-self:flex-start}
      .wb-seg button{height:26px;padding:0 10px;border:0;background:transparent;border-radius:8px;color:var(--wb-text-2);font:inherit;font-size:var(--wb-fs-xs);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px}
      .wb-slider{accent-color:var(--wb-primary);min-width:120px}
      .wb-seg button.on{background:var(--wb-card);color:var(--wb-text);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}
      .wb-empty-state{display:flex;flex-direction:column;align-items:center;gap:8px;padding:26px 16px;color:var(--wb-text-3);text-align:center}
      .wb-empty-state b{color:var(--wb-text);font-size:var(--wb-fs-md)}
      .wb-skeleton{background:linear-gradient(90deg,var(--wb-surface-2) 25%,var(--wb-surface-3) 37%,var(--wb-surface-2) 63%);background-size:400% 100%;animation:wb-shimmer 1.4s ease infinite;border-radius:var(--wb-r-md);height:14px}
      @keyframes wb-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
      .wb-drawer-ov{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:210}
      .wb-drawer{position:fixed;top:0;right:0;bottom:0;width:min(420px,92vw);background:var(--wb-card);border-left:1px solid var(--wb-border);z-index:211;display:flex;flex-direction:column;gap:12px;padding:16px 20px;overflow:auto;box-shadow:-8px 0 32px rgba(0,0,0,.16)}
      .wb-drawer-head{display:flex;align-items:center;gap:8px}
      .wb-toast{position:fixed;bottom:76px;left:50%;transform:translateX(-50%);z-index:400;min-width:280px;max-width:min(520px,92vw);background:#1F2937;color:#fff;border-radius:var(--wb-r-md);padding:10px 14px;font-size:var(--wb-fs-xs);box-shadow:0 12px 32px rgba(0,0,0,.24);display:flex;gap:10px;align-items:center;overflow:hidden}
      .wb-toast.error{background:#B91C1C}
      .wb-stepper{display:inline-flex;align-items:center;gap:4px}.wb-stepper .wb-btn{padding:0 8px;min-width:28px}
      .wb-adv{border:1px solid var(--wb-border);border-radius:var(--wb-r-md);padding:8px 12px}.wb-adv summary{cursor:pointer;font-size:var(--wb-fs-sm);font-weight:600;color:var(--wb-text-2)}.wb-adv[open] summary{margin-bottom:8px}
      .wb-ai-off{display:flex;align-items:flex-start;gap:10px;margin:12px 20px 0;padding:10px 14px;border-radius:var(--wb-r-md);border:1px solid var(--wb-ai-line);background:var(--wb-ai-soft);color:var(--wb-text);font-size:var(--wb-fs-xs);line-height:1.6}
      .wb-ai-off b{color:var(--wb-ai)}
      .wb-toast .wb-toast-bar{position:absolute;left:0;bottom:0;height:2px;background:rgba(255,255,255,.65);transition:width .2s linear}
      .wb-field-error{color:var(--wb-danger);font-size:11px;line-height:1.5}
      .wb-input.invalid,.wb-textarea.invalid{border-color:var(--wb-danger)}

      .wb-body{flex:1 1 auto;min-height:0;overflow:auto;padding:20px;display:flex;flex-direction:column;gap:16px}
      .wb-body-fill{overflow:hidden}
      .wb-today{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:16px;flex:1 1 auto;min-height:0}
      .wb-today-narrow{grid-template-columns:minmax(0,1fr);grid-auto-rows:max-content;align-content:start;overflow:auto;padding-bottom:8px}
      .wb-today-narrow > .wb-col{overflow:visible;min-height:0}
      .wb-today-narrow .wb-todo-card{overflow:visible;flex:none}
      .wb-today-narrow .wb-todo-body{overflow:visible}
      .wb-today > .wb-card{min-height:0;overflow:auto}
      .wb-today > .wb-col{display:flex;flex-direction:column;gap:14px;min-height:0;overflow:auto}
      @media(max-width:1080px){.wb-today{grid-template-columns:minmax(0,1fr);overflow:auto}.wb-today > .wb-card{overflow:visible}}
      .wb-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:16px}
      @media (max-width:1080px){.wb-grid{grid-template-columns:minmax(0,1fr)}}
      .wb-card{background:var(--wb-card);border:1px solid var(--wb-border);border-radius:12px;box-shadow:var(--wb-shadow);padding:16px 18px;display:flex;flex-direction:column;gap:10px;min-width:0}
      .wb-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .wb-card-title{font-size:13px;font-weight:650}
      .wb-badge{font-size:11px;color:var(--wb-muted);border:1px solid var(--wb-border);border-radius:999px;padding:1px 8px}
      .wb-badge.warn{color:#d97706;border-color:rgba(217,119,6,.4)}
      .wb-badge.risk{color:#dc2626;border-color:rgba(220,38,38,.4)}
      .wb-muted{color:var(--wb-muted)}
      .wb-small{font-size:12px}
      .wb-input,.wb-textarea,.wb-select{width:100%;box-sizing:border-box;font:inherit;color:var(--wb-text);background:var(--wb-card);border:1px solid var(--wb-border-strong);border-radius:var(--wb-r-md);padding:8px 10px;outline:none}
      .wb-input:focus,.wb-textarea:focus,.wb-select:focus{border-color:var(--wb-accent)}
      .wb-select{background:var(--wb-card)}
      .wb-textarea{resize:vertical;min-height:88px;line-height:1.65}
      .wb-list{display:flex;flex-direction:column;gap:6px}
      .wb-todo{display:flex;align-items:flex-start;gap:9px;padding:9px 10px;border-radius:var(--wb-r-md);background:transparent;border:1px solid transparent;width:100%;box-sizing:border-box}
      .wb-todo > .wb-btn{flex:none;white-space:nowrap}
      .wb-todo-text > .wb-todo-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .wb-todo:hover{border-color:var(--wb-border)}
      .wb-check{appearance:none;width:16px;height:16px;margin-top:2px;border:1.5px solid var(--wb-muted);border-radius:5px;cursor:pointer;flex:0 0 auto;position:relative;padding:0;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box}
      .wb-check:checked{background:var(--wb-accent);border-color:var(--wb-accent)}
      .wb-check:checked::after{content:"";position:absolute;left:4px;top:1px;width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
      .wb-todo.done .wb-todo-text{text-decoration:line-through;color:var(--wb-muted)}
      .wb-todo-text{flex:1 1 auto;min-width:0;word-break:break-word}
      .wb-meta{font-size:11px;color:var(--wb-muted);margin-top:2px}
      .wb-meta .wb-ai-tag{height:18px;padding:0 6px;font-size:10px}
      .wb-empty{color:var(--wb-muted);font-size:12px;padding:8px 2px}
      .wb-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .wb-row.end{justify-content:flex-end}
      .wb-sep{height:1px;background:var(--wb-border);margin:2px 0}
      .wb-md{font-size:13px;line-height:1.7}
      .wb-md h2{font-size:14px;margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid var(--wb-border)}
      .wb-md h2:first-child{margin-top:0}
      .wb-md ul{margin:0;padding-left:20px}
      .wb-md li{margin:2px 0}
      .wb-md p{margin:6px 0}
      .wb-tabsrow{display:flex;gap:6px;flex-wrap:wrap}
      .wb-reports{display:grid;grid-template-columns:220px minmax(0,1fr);gap:16px}
      @media (max-width:900px){.wb-reports{grid-template-columns:minmax(0,1fr)}}
      .wb-report-list{display:flex;flex-direction:column;gap:4px;max-height:calc(100vh - 290px);overflow:auto}
      .wb-list-group{font-size:11px;color:var(--wb-text-3);font-weight:650;margin:8px 4px 4px}
      .wb-editbar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;background:var(--wb-primary-soft);border:1px solid rgba(37,99,235,.25);font-size:12px}
      .wb-report-item{text-align:left;border:0;background:transparent;color:var(--wb-text);font:inherit;padding:7px 10px;border-radius:8px;cursor:pointer}
      .wb-report-item:hover{background:rgba(127,127,127,.08)}
      .wb-report-item.active{background:rgba(59,130,246,.12);color:var(--wb-accent)}
      .wb-field{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .wb-field label{min-width:104px;color:var(--wb-muted);font-size:12px}
      .wb-field .wb-input,.wb-field .wb-select{max-width:240px}
      .wb-kv{display:grid;grid-template-columns:120px minmax(0,1fr);gap:4px 10px;font-size:12px}
      .wb-kv div:nth-child(odd){color:var(--wb-muted)}
      .wb-spin{display:inline-block;width:12px;height:12px;border:2px solid var(--wb-border);border-top-color:var(--wb-accent);border-radius:50%;animation:wb-spin .8s linear infinite}
      @keyframes wb-spin{to{transform:rotate(360deg)}}
      .wb-progress{height:8px;border-radius:999px;background:rgba(127,127,127,.16);overflow:hidden;flex:1 1 auto;min-width:80px}
      .wb-progress > i{display:block;height:100%;background:var(--wb-accent);border-radius:999px;transition:width .2s ease}
      .wb-progress.high > i{background:#10b981}
      .wb-progress.low > i{background:#f59e0b}
      .wb-goal{padding:12px 14px;border:1px solid var(--wb-border);border-radius:12px;display:flex;flex-direction:column;gap:8px;background:var(--wb-card)}
      .wb-goal.child{margin-left:22px}
      .wb-goal.grandchild{margin-left:44px}
      .wb-goal-title{font-weight:600;font-size:13px}
      .wb-imp-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .wb-imp-head .wb-imp-count{font-size:14px;font-weight:600;color:var(--wb-text)}
      .wb-imp-head .wb-imp-sub{font-size:12px;color:var(--wb-text-3)}
      .wb-imp-src{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:var(--wb-r-md);background:var(--wb-surface-2);font-size:12px;color:var(--wb-text-3)}
      .wb-imp-src span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .wb-imp-tree{display:flex;flex-direction:column;gap:12px}
      .wb-imp-group{border:1px solid var(--wb-border);border-radius:var(--wb-r-lg);background:var(--wb-card);overflow:hidden;padding-bottom:6px}
      .wb-imp-group:has(> .wb-imp-node.only){padding-bottom:0}
      .wb-imp-node{position:relative;display:flex;gap:8px;align-items:flex-start;padding:8px 12px 8px 6px;border-radius:8px;cursor:pointer;transition:background .12s}
      .wb-imp-node:hover{background:var(--wb-surface-2)}
      .wb-imp-node.editing{background:var(--wb-ai-soft)}
      .wb-imp-node.root{padding:14px 14px 14px 10px;border-radius:0;background:linear-gradient(90deg,var(--wb-ai-soft),transparent 75%);border-bottom:1px solid var(--wb-border);margin-bottom:6px}
      .wb-imp-node.root:hover{background:var(--wb-ai-soft)}
      .wb-imp-node.root::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--wb-ai)}
      .wb-imp-node.root.only{border-bottom:0;margin-bottom:0}
      .wb-imp-kids{margin-left:20px}
      .wb-imp-group > .wb-imp-kids{margin-left:22px;margin-right:8px}
      .wb-imp-branch{position:relative;padding-left:14px}
      .wb-imp-branch::before{content:"";position:absolute;left:0;top:0;bottom:0;border-left:1px solid var(--wb-border-strong)}
      .wb-imp-branch:last-child::before{bottom:auto;height:19px}
      .wb-imp-branch::after{content:"";position:absolute;left:0;top:19px;width:10px;border-top:1px solid var(--wb-border-strong)}
      .wb-imp-caret{flex:none;width:16px;height:20px;margin-top:1px;border:0;padding:0;background:transparent;color:var(--wb-text-3);cursor:pointer;font-size:11px;line-height:20px;border-radius:4px;transition:transform .15s}
      .wb-imp-caret:hover{color:var(--wb-text);background:var(--wb-surface-3)}
      .wb-imp-caret.closed{transform:rotate(-90deg)}
      .wb-imp-caret.empty{cursor:default;background:transparent}
      .wb-imp-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
      .wb-imp-title{font-size:13px;font-weight:500;color:var(--wb-text);line-height:1.5}
      .wb-imp-node.lv-年 .wb-imp-title{font-size:16px;font-weight:700;letter-spacing:.2px}
      .wb-imp-node.lv-季度 .wb-imp-title{font-size:14px;font-weight:650}
      .wb-imp-node.lv-月 .wb-imp-title{font-size:13.5px;font-weight:600}
      .wb-imp-measure{font-size:12px;color:var(--wb-text-3);line-height:1.55;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
      .wb-imp-node.lv-年 .wb-imp-measure{font-size:12.5px;color:var(--wb-text-2);-webkit-line-clamp:3}
      .wb-imp-node.lv-季度 .wb-imp-measure{-webkit-line-clamp:2}
      .wb-imp-meta{margin-top:2px;font-size:11px;color:var(--wb-text-3)}
      .wb-imp-date{flex:none;font-size:11px;color:var(--wb-text-3);line-height:22px;font-variant-numeric:tabular-nums;white-space:nowrap}
      .wb-imp-cycle{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:20px;padding:0 6px;margin-top:1px;border-radius:6px;font-size:11px;font-weight:600;background:var(--wb-surface-2);color:var(--wb-text-2)}
      .wb-imp-cycle.c-年{background:var(--wb-ai);color:#fff;height:22px;margin-top:2px}
      .wb-imp-cycle.c-季度{background:rgba(99,102,241,.14);color:#4F46E5}
      .wb-imp-cycle.c-月{background:var(--wb-primary-soft);color:var(--wb-primary)}
      .wb-imp-cycle.c-周{background:rgba(16,185,129,.14);color:#047857}
      .wb-root[data-wb-theme="dark"] .wb-imp-cycle.c-年{background:#7C3AED}
      .wb-root[data-wb-theme="dark"] .wb-imp-cycle.c-季度{background:rgba(129,140,248,.18);color:#A5B4FC}
      .wb-root[data-wb-theme="dark"] .wb-imp-cycle.c-月{color:#93C5FD}
      .wb-root[data-wb-theme="dark"] .wb-imp-cycle.c-周{background:rgba(52,211,153,.16);color:#6EE7B7}
      .wb-imp-acts{flex:none;display:flex;gap:2px;opacity:0;transition:opacity .12s}
      .wb-imp-node:hover .wb-imp-acts,.wb-imp-node:focus-within .wb-imp-acts{opacity:1}
      .wb-imp-node:hover .wb-imp-date{display:none}
      .wb-imp-act{border:0;background:transparent;color:var(--wb-text-3);cursor:pointer;font:inherit;font-size:12px;padding:2px 8px;border-radius:6px}
      .wb-imp-act:hover{background:var(--wb-surface-3);color:var(--wb-text)}
      .wb-imp-act.danger:hover{color:var(--wb-danger)}
      .wb-imp-edit{margin:4px 8px 10px 30px;padding:12px;border:1px solid var(--wb-ai-line);border-radius:var(--wb-r-md);background:var(--wb-card);display:flex;flex-direction:column;gap:8px;cursor:default}
      .wb-imp-edit label{font-size:11px;color:var(--wb-text-3);display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
      .wb-imp-edit .wb-imp-grid{display:flex;gap:8px}
      .wb-imp-foot{position:sticky;bottom:-16px;margin:4px -18px -16px;padding:12px 18px;background:var(--wb-card);border-top:1px solid var(--wb-border);display:flex;align-items:center;gap:8px;z-index:2}
      .wb-imp-foot .wb-imp-sum{flex:1;font-size:12px;color:var(--wb-text-3)}
      .wb-imp-foot .wb-imp-sum b{color:var(--wb-text);font-weight:600}
      .wb-suggest{border:1px dashed var(--wb-accent);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;background:rgba(59,130,246,.05)}
      .wb-suggest-item{border-top:1px solid var(--wb-ai-line);padding-top:8px;display:flex;flex-direction:column;gap:4px;min-width:0}
      .wb-quote{font-size:12px;color:var(--wb-muted);border-left:3px solid var(--wb-border);padding-left:8px}
      .wb-model{display:flex;align-items:center;gap:6px}
      .wb-model .wb-select{max-width:min(320px,42vw);padding:4px 8px;border-radius:8px;font-size:12px}
      .wb-inline-edit{flex:1 1 auto;display:flex;gap:6px}
      .wb-inline-edit .wb-input{padding:4px 8px}
      .wb-cycle{margin-top:4px}
      .wb-cycle-title{font-size:12px;color:var(--wb-muted);margin:6px 0 8px}
      .wb-rel{position:relative}
      .wb-model-btn{display:flex;align-items:center;gap:6px;border:1px solid var(--wb-border);background:var(--wb-card);color:var(--wb-text);font:inherit;font-size:12px;padding:4px 10px;border-radius:9px;cursor:pointer;max-width:min(360px,44vw)}
      .wb-model-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .wb-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#10b981;flex:0 0 auto}
      .wb-dot.bad{background:#ef4444}
      .wb-pop{position:absolute;right:0;top:calc(100% + 6px);width:340px;max-width:86vw;background:var(--wb-card);border:1px solid var(--wb-border);border-radius:12px;box-shadow:var(--wb-shadow);z-index:40;padding:8px;display:flex;flex-direction:column;gap:6px}
      .wb-pop .wb-input{padding:6px 8px}
      .wb-pop-list{max-height:330px;overflow:auto;display:flex;flex-direction:column;gap:2px}
      .wb-group-head{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;color:var(--wb-muted);font-size:11px;cursor:pointer;border-radius:8px;background:transparent;border:0;font-family:inherit;width:100%}
      .wb-group-head:hover{background:rgba(127,127,127,.08)}
      .wb-opt{padding:6px 8px;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;font-size:12px;border:0;background:transparent;color:var(--wb-text);font-family:inherit;text-align:left;width:100%}
      .wb-opt:hover{background:rgba(59,130,246,.12)}
      .wb-opt.active{color:var(--wb-accent);font-weight:600}
      .wb-opt small{color:var(--wb-muted);white-space:nowrap}
      .wb-todo-group{display:flex;flex-direction:column;gap:6px;margin-top:6px}
      .wb-group-title{font-size:11px;color:var(--wb-muted);display:flex;align-items:center;gap:8px;background:transparent;border:0;padding:6px 2px;width:100%;text-align:left;font-family:inherit;cursor:pointer;border-radius:6px}
      .wb-group-title:hover{background:var(--wb-surface-2);color:var(--wb-text-2)}
      .wb-group-title i{font-style:normal;border:1px solid var(--wb-border);border-radius:999px;padding:0 7px}
      .wb-date{font-size:11px;border:1px solid var(--wb-border);border-radius:6px;padding:1px 6px;color:var(--wb-muted)}
      .wb-chip{font-size:11px;border:1px solid var(--wb-border);border-radius:999px;padding:2px 8px;cursor:pointer;background:transparent;color:var(--wb-muted);font-family:inherit}
      .wb-chip:hover{border-color:var(--wb-accent);color:var(--wb-accent)}
      .wb-chip.on{border-color:var(--wb-primary);color:var(--wb-primary);font-weight:600;background:var(--wb-primary-soft)}
      .wb-range{display:flex;align-items:center;gap:6px;width:100%}
      .wb-cov{display:flex;align-items:center;gap:2px;flex-wrap:wrap;max-width:100%}
      .wb-cov i{display:block;width:6px;height:14px;border-radius:3px;background:var(--wb-surface-3)}
      .wb-cov i.has{background:var(--wb-primary)}
      .wb-cov i.fut{background:transparent;border:1px dashed var(--wb-border-strong);box-sizing:border-box}
      .wb-steps{display:flex;flex-direction:column;gap:12px}
      .wb-step{display:flex;gap:10px;align-items:flex-start}
      .wb-step-no{width:20px;height:20px;border-radius:50%;background:var(--wb-accent);color:#fff;font-size:11px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;margin-top:2px}
      .wb-step-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px}
      .wb-toolbar{display:flex;gap:6px;flex-wrap:wrap}
      .wb-iframe{width:100%;height:540px;border:1px solid var(--wb-border);border-radius:10px;background:#fff}
      .wb-file{display:flex;justify-content:space-between;font-size:12px;color:var(--wb-muted);gap:10px}
      .wb-modal{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:200;padding:24px}
      .wb-modal.l2{z-index:230;background:rgba(0,0,0,.55)}
      .wb-modal-card.size-sm{width:min(440px,94vw)}
      .wb-modal-card.size-md{width:min(560px,94vw)}
      .wb-modal-card.size-lg{width:min(760px,94vw)}
      .wb-modal-card.size-xl{width:min(960px,96vw)}
      .wb-modal-card{background:var(--wb-card);color:var(--wb-text);border-radius:14px;width:min(880px,94vw);min-width:min(360px,92vw);max-height:88vh;overflow:auto;resize:both;padding:16px 18px;display:flex;flex-direction:column;gap:10px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
      .wb-modal-card > .wb-row.end{margin-top:2px;position:sticky;bottom:-16px;z-index:5;background:var(--wb-card);border-top:1px solid var(--wb-border);padding:10px 0;margin-bottom:-16px}
      .wb-modal-head{display:flex;align-items:center;gap:8px}
      .wb-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
      .wb-qbtn{position:fixed;z-index:10020;pointer-events:auto;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 36%,var(--dsw-alias-border-l1));background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.22);font:12px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;cursor:pointer;white-space:nowrap}
      .wb-qbtn:hover{background:var(--dsw-alias-bg-layer-2)}
      .wb-qbtn:disabled{opacity:.6;cursor:default}
      .wb-qmenu{position:fixed;z-index:9999;min-width:172px;background:#fff;color:#111827;border:1px solid rgba(15,23,42,.12);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.22);padding:4px;display:flex;flex-direction:column}
      .wb-qmenu button{display:flex;align-items:center;gap:8px;border:0;background:transparent;color:inherit;font:12px/1.4 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:7px 10px;border-radius:7px;cursor:pointer;text-align:left}
      .wb-qmenu button:hover{background:rgba(59,130,246,.12)}
      .wb-qtoast{position:fixed;z-index:10000;right:20px;bottom:20px;max-width:380px;background:#111827;color:#fff;border-radius:10px;padding:9px 13px;font:12px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.3);display:flex;gap:8px;align-items:flex-start}
      .wb-qtoast.error{background:#b91c1c}
      .wb-modal-card.wide{width:min(1000px,96vw)}
      .wb-tags{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
      .wb-tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;line-height:1.7;padding:1px 9px;border-radius:999px;background:rgba(59,130,246,.1);color:var(--wb-accent);border:1px solid rgba(59,130,246,.25)}
      .wb-tag button{border:0;background:transparent;color:inherit;cursor:pointer;opacity:.6;padding:0;font-size:12px;line-height:1}
      .wb-tag button:hover{opacity:1}
      body.wb-dragging,body.wb-dragging *{user-select:none!important;cursor:col-resize!important}
      .wb-split{width:8px;cursor:col-resize;align-self:stretch;display:flex;align-items:center;justify-content:center;border-radius:4px}
      .wb-split:hover{background:rgba(127,127,127,.18)}
      .wb-split::after{content:"";width:2px;height:min(160px,60%);background:var(--wb-border);border-radius:2px}
      .wb-vstack{display:flex;flex-direction:column;min-height:0;height:100%}
      .wb-vitem{min-height:120px;display:flex;flex-direction:column;min-width:0;overflow:hidden}
      .wb-vitem > .wb-card{flex:1 1 auto;min-height:0;overflow:auto}
      .wb-vsplit{height:10px;flex:0 0 auto;cursor:row-resize;display:flex;align-items:center;justify-content:center;border-radius:5px}
      .wb-vsplit::after{content:"";width:42px;height:2px;background:var(--wb-border);border-radius:2px}
      .wb-vsplit:hover::after{background:var(--wb-accent)}
      body.wb-vdragging,body.wb-vdragging *{user-select:none!important;cursor:row-resize!important}
      .wb-split:hover::after{background:var(--wb-accent)}
      .wb-okr{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--wb-border);border-radius:12px;background:var(--wb-card)}
      .wb-okr + .wb-okr{margin-top:10px}
      .wb-okr-head{display:flex;align-items:center;gap:9px}
      .wb-okr-o{width:22px;height:22px;border-radius:7px;background:rgba(59,130,246,.14);color:var(--wb-accent);font-size:11px;display:flex;align-items:center;justify-content:center;font-weight:700;flex:0 0 auto}
      .wb-okr-title{font-weight:650;font-size:13px;line-height:1.5}
      .wb-okr-pct{margin-left:auto;font-size:12px;color:var(--wb-muted);font-variant-numeric:tabular-nums;border:0;background:transparent;font-family:inherit;cursor:pointer;padding:2px 5px;border-radius:6px}
      .wb-okr-pct:hover{background:var(--wb-surface-2);color:var(--wb-text)}
      .wb-okr-bar{height:6px;border-radius:999px;background:rgba(127,127,127,.16);overflow:hidden}
      .wb-okr-bar>i{display:block;height:100%;background:var(--wb-accent);border-radius:999px}
      .wb-okr-measure{font-size:11px;color:var(--wb-muted)}
      .wb-okr-detail{margin-top:3px;font-size:11px;color:var(--wb-text-3);line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .wb-okr-krs{display:flex;flex-direction:column;gap:9px;margin-top:2px;padding-left:13px;border-left:1px dashed var(--wb-border)}
      .wb-kr{display:flex;flex-direction:column;gap:4px}
      .wb-kr-head{display:flex;align-items:center;gap:8px;font-size:12px}
      .wb-kr-label{font-size:10px;line-height:1.6;color:var(--wb-accent);border:1px solid rgba(59,130,246,.35);border-radius:999px;padding:0 6px;flex:0 0 auto}
      .wb-kr-title{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .wb-kr-pct{color:var(--wb-muted);font-variant-numeric:tabular-nums;border:0;background:transparent;font:inherit;font-size:12px;cursor:pointer;padding:1px 4px;border-radius:5px}
      .wb-kr-pct:hover{background:var(--wb-surface-2);color:var(--wb-text)}
      .wb-kr-bar{height:4px;border-radius:999px;background:rgba(127,127,127,.14);overflow:hidden}
      .wb-kr-bar>i{display:block;height:100%;background:rgba(59,130,246,.65);border-radius:999px}
      .wb-okr-actions{display:flex;gap:2px;opacity:.6}
      .wb-okr:hover .wb-okr-actions{opacity:1}
      .wb-okr-child-actions{display:flex;gap:2px;opacity:.5}
      .wb-kr:hover .wb-okr-child-actions{opacity:1}
      .wb-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .wb-form-grid .full{grid-column:1/-1}
      .wb-form-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--wb-muted)}
      .wb-form-field .wb-input,.wb-form-field .wb-select,.wb-form-field .wb-textarea{color:var(--wb-text)}
      .wb-field-error{color:#dc2626;font-size:11px;line-height:1.5}
      .wb-section-title{font-size:13px;font-weight:650;color:var(--wb-text);margin:14px 0 2px}
      .wb-period{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .wb-period-opt{position:relative;display:flex;align-items:flex-start;gap:10px;text-align:left;padding:12px 14px;border-radius:12px;border:1px solid var(--wb-border);background:transparent;color:var(--wb-text);font:inherit;cursor:pointer;transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}
      .wb-period-opt:hover{border-color:color-mix(in srgb,var(--wb-accent) 55%,var(--wb-border));background:color-mix(in srgb,var(--wb-accent) 5%,transparent)}
      .wb-period-opt.active{border-color:var(--wb-accent);background:color-mix(in srgb,var(--wb-accent) 9%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--wb-accent) 12%,transparent)}
      .wb-period-radio{width:16px;height:16px;border-radius:50%;border:1.5px solid var(--wb-border);flex:0 0 auto;margin-top:2px;display:flex;align-items:center;justify-content:center}
      .wb-period-opt.active .wb-period-radio{border-color:var(--wb-accent)}
      .wb-period-opt.active .wb-period-radio::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--wb-accent)}
      .wb-period-body{display:flex;flex-direction:column;gap:2px;min-width:0}
      .wb-period-title{font-size:13px;font-weight:650}
      .wb-period-desc{font-size:11px;color:var(--wb-muted);line-height:1.5}
      .wb-section-title:first-of-type{margin-top:2px}
      .wb-input.invalid,.wb-textarea.invalid{border-color:#dc2626}
      .wb-combo{position:relative}
      .wb-cal2{display:flex;flex-direction:column;gap:10px}
      .wb-cal2-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
      .wb-cal2-count{font-size:10px;color:var(--wb-text-3);white-space:nowrap}
      .wb-cal2-title{font-size:15px;font-weight:700;letter-spacing:.01em}
      .wb-cal2-year{font-size:11px;color:var(--wb-muted)}
      .wb-cal2-nav{width:26px;height:26px;border-radius:8px;border:0;background:transparent;color:var(--wb-muted);cursor:pointer;font-size:13px;display:inline-flex;align-items:center;justify-content:center;transition:background .15s ease,color .15s ease}
      .wb-cal2-nav:hover{background:rgba(127,127,127,.14);color:var(--wb-text)}
      .wb-cal2-week{display:grid;grid-template-columns:repeat(7,1fr);font-size:11px;color:var(--wb-muted);text-align:center;padding:2px 0}
      .wb-cal2-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
      .wb-cal2-cell{min-height:52px;border:0;border-radius:9px;background:rgba(127,127,127,.045);padding:5px 6px;display:flex;flex-direction:column;gap:4px;cursor:pointer;color:var(--wb-text);font:inherit;text-align:left;min-width:0;transition:background .15s ease}
      .wb-cal2-cell:hover{background:rgba(59,130,246,.1)}
      .wb-cal2-cell.out{background:transparent;color:var(--wb-text-3)}
      .wb-cal2-cell.out .wb-cal2-daynum{color:var(--wb-text-3)}
      .wb-cal2-cell.today{background:rgba(59,130,246,.12)}
      .wb-cal2-day{font-size:11px;color:var(--wb-muted);display:flex;align-items:center;justify-content:space-between}
      .wb-cal2-daynum{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:9px;font-variant-numeric:tabular-nums}
      .wb-cal2-cell.today .wb-cal2-daynum{background:var(--wb-accent);color:#fff;font-weight:700}
      .wb-cal2-chip{display:flex;align-items:center;gap:4px;font-size:10px;line-height:1.6;padding:1px 6px;border-radius:6px;background:var(--wb-card);border:1px solid var(--wb-border);color:var(--wb-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .wb-cal2-dot{width:5px;height:5px;border-radius:50%;background:var(--wb-accent);flex:0 0 auto}
      .wb-cal2-empty{font-size:10px;color:transparent}
      .wb-cal2-foot{display:flex;align-items:center;gap:8px;padding-top:8px;border-top:1px solid var(--wb-border)}
      .wb-spin{display:inline-block;width:11px;height:11px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:wb-spin .7s linear infinite;flex:0 0 auto;vertical-align:-1px;margin-right:6px}
      .wb-gantt{display:flex;flex-direction:column;gap:2px;overflow:hidden}
      .wb-gantt-head{display:grid;grid-template-columns:190px minmax(0,1fr);gap:12px;font-size:10px;color:var(--wb-muted);padding-bottom:4px}
      .wb-gantt-axis{display:flex;justify-content:space-between}
      .wb-gantt-row{display:grid;grid-template-columns:190px minmax(0,1fr);gap:12px;align-items:center;padding:3px 0}
      .wb-gantt-label{display:flex;align-items:center;gap:6px;font-size:12px;min-width:0}
      .wb-gantt-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .wb-gantt-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto}
      .wb-gantt-track{position:relative;height:24px;border-radius:7px;background:rgba(127,127,127,.07);overflow:hidden}
      .wb-gantt-grid{position:absolute;inset:0;background-image:repeating-linear-gradient(to right,rgba(127,127,127,.14) 0 1px,transparent 1px 14.2857%);opacity:.5}
      .wb-gantt-bar{position:absolute;top:5px;bottom:5px;border-radius:6px;min-width:8px;display:flex;align-items:center;justify-content:flex-end;padding-right:5px;font-size:9px;color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15)}
      .wb-gantt-today{position:absolute;top:0;bottom:0;width:0;border-left:1px dashed rgba(239,68,68,.75)}
      .wb-gantt-today::before{content:"今天";position:absolute;top:-14px;left:-10px;font-size:9px;color:#ef4444;background:var(--wb-card);padding:0 3px;border-radius:3px}
      .wb-plus{width:28px;height:28px;border-radius:8px;border:1px solid var(--wb-border);background:var(--wb-card);color:var(--wb-text);cursor:pointer;font-size:15px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
      .wb-plus:hover{border-color:var(--wb-accent);color:var(--wb-accent)}
      .wb-assist-files{display:flex;gap:6px;flex-wrap:wrap}
      .wb-assist-file{display:inline-flex;align-items:center;gap:4px;font-size:11px;border:1px solid var(--wb-border);border-radius:999px;padding:1px 8px;color:var(--wb-muted)}
      .wb-assist-file button{border:0;background:transparent;color:inherit;cursor:pointer;padding:0;opacity:.6}
      .wb-assist{display:flex;flex-direction:column;gap:8px;min-height:0}
      .wb-todo-card{flex:1 1 auto;min-height:0;overflow:hidden}
      .wb-todo-body{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;padding-right:2px}
      .wb-assist-ta{min-height:56px}
      .wb-assist-hint{font-size:11px;color:var(--wb-muted)}
      .wb-combo-list{position:absolute;z-index:65;top:calc(100% + 4px);left:0;right:0;max-height:220px;overflow:auto;background:var(--wb-card);border:1px solid var(--wb-border);border-radius:10px;box-shadow:var(--wb-shadow);padding:4px}
      .wb-combo-item{display:flex;gap:8px;align-items:center;width:100%;border:0;background:transparent;color:var(--wb-text);font:inherit;font-size:12px;padding:6px 8px;border-radius:7px;cursor:pointer;text-align:left}
      .wb-combo-item:hover{background:rgba(59,130,246,.12)}
      .wb-todo.selected{background:rgba(59,130,246,.1);border-color:rgba(59,130,246,.35)}
      .wb-select-check{width:15px;height:15px;margin-top:2px;flex:0 0 auto;cursor:pointer}
      .wb-datefield{position:relative;width:100%}
      .wb-date-btn{width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;font:inherit;color:var(--wb-text);background:var(--wb-card);border:1px solid var(--wb-border);border-radius:9px;padding:8px 10px;cursor:pointer;text-align:left}
      .wb-date-btn:hover{border-color:var(--wb-accent);background:var(--wb-card)}
      .wb-date-btn:focus,.wb-date-btn:focus-visible,.wb-date-btn:active{outline:none;box-shadow:none}
      .wb-date-btn.empty{color:var(--wb-muted)}
      .wb-date-btn[aria-expanded="true"]{border-color:var(--wb-primary);box-shadow:0 0 0 3px var(--wb-primary-soft)}
      .wb-cal{position:fixed;z-index:9999;width:258px;background:var(--wb-card);border:1px solid var(--wb-border);border-radius:12px;box-shadow:var(--wb-shadow);padding:10px}
      .wb-cal-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:12px}
      .wb-cal-title{font-weight:600}
      .wb-cal-nav{border:0;background:transparent;color:var(--wb-muted);cursor:pointer;border-radius:6px;width:22px;height:22px;font-size:13px}
      .wb-cal-nav:hover{background:rgba(127,127,127,.12);color:var(--wb-text)}
      .wb-cal-week{display:grid;grid-template-columns:repeat(7,1fr);font-size:10px;color:var(--wb-muted);text-align:center;margin-bottom:2px}
      .wb-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
      .wb-cal-cell{border:0;background:transparent;color:var(--wb-text);font:inherit;font-size:11px;height:26px;border-radius:7px;cursor:pointer}
      .wb-cal-cell:hover{background:rgba(59,130,246,.12)}
      .wb-cal-cell.out{color:var(--wb-muted);opacity:.45}
      .wb-cal-cell.today{border:1px solid var(--wb-accent);color:var(--wb-accent)}
      .wb-cal-cell.selected{background:var(--wb-accent);color:#fff}
      .wb-cal-foot{display:flex;justify-content:space-between;margin-top:6px}
      .wb-banner{display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap;background:linear-gradient(120deg,rgba(59,130,246,.12),rgba(99,102,241,.06));border:1px solid var(--wb-border);border-radius:12px;padding:14px 16px}
      .wb-banner-facts{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;flex:0 1 auto}
      .wb-banner-item{font-size:12px;color:var(--wb-muted);display:inline-flex;align-items:center;gap:5px}
      .wb-banner-item.time{font-size:15px;font-weight:650;color:var(--wb-text);font-variant-numeric:tabular-nums}
      .wb-banner-quote{flex:1 1 0;min-width:0;text-align:left;font-size:15px;font-weight:650;line-height:1.65;color:var(--wb-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .wb-banner-quote small{display:inline;font-weight:400;font-size:11px;color:var(--wb-muted);margin-left:6px}
      @media(max-width:700px){.wb-banner-quote{flex-basis:100%;white-space:normal;font-size:14px;line-height:1.55}}
      .wb-cycle-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:6px;font-size:10px;font-weight:700;margin-right:6px;flex:0 0 auto}
      .wb-cycle-badge.年{background:rgba(139,92,246,.16);color:#7c3aed}
      .wb-cycle-badge.季度{background:rgba(99,102,241,.16);color:#4f46e5}
      .wb-cycle-badge.月{background:rgba(59,130,246,.16);color:#2563eb}
      .wb-cycle-badge.周{background:rgba(16,185,129,.16);color:#059669}
      .wb-okr-grid{align-items:start}
      .wb-okr-grid > .wb-okr{margin-top:0}
      .wb-banner-left{display:flex;align-items:baseline;gap:10px;font-weight:650;font-size:15px}
      .wb-banner-sub{font-size:12px;color:var(--wb-muted);font-weight:400}
      .wb-okr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      @media(max-width:1080px){.wb-okr-grid{grid-template-columns:minmax(0,1fr)}}
      .wb-group-title.clickable{cursor:pointer;user-select:none}
      .wb-group-title.clickable:hover{color:var(--wb-text)}
      .wb-action{display:inline-flex;align-items:center;gap:5px;height:24px;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;line-height:1;opacity:.66;cursor:pointer;padding:0 6px;border-radius:7px;white-space:nowrap;vertical-align:middle}
      .wb-action:hover{opacity:1;background:rgba(127,127,127,.14)}
      .wb-action svg{flex:0 0 auto}
      .wb-action.saved{color:#10b981;opacity:1}
      .wb-qbtn svg{flex:0 0 auto}
      .wb-notice{background:var(--wb-card);color:var(--wb-text);border:1px solid var(--wb-border);border-radius:12px;box-shadow:var(--wb-shadow);padding:12px 14px;display:flex;align-items:flex-start;gap:10px}
      .wb-notice-title{font-weight:650;font-size:13px;display:flex;align-items:center;gap:8px}
      .wb-notice-body{font-size:12px;line-height:1.6;white-space:pre-wrap}
      .wb-notice-foot{display:flex;align-items:center;gap:8px;flex:0 0 auto}
      .wb-export{position:absolute;right:0;top:calc(100% + 6px);min-width:160px;background:var(--wb-card);border:1px solid var(--wb-border);border-radius:10px;box-shadow:var(--wb-shadow);z-index:50;padding:4px;display:flex;flex-direction:column}
      .wb-export button{border:0;background:transparent;color:var(--wb-text);font:inherit;font-size:12px;text-align:left;padding:7px 10px;border-radius:7px;cursor:pointer}
      .wb-export button:hover{background:rgba(59,130,246,.12)}
      .wb-doc{border:1px solid var(--wb-border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;cursor:pointer;background:transparent;text-align:left;color:var(--wb-text);font:inherit}
      .wb-doc:hover{border-color:var(--wb-accent);background:rgba(59,130,246,.06)}
      .wb-doc.active{border-color:var(--wb-accent);background:rgba(59,130,246,.1)}
      .wb-doc-title{font-weight:600;font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
      .wb-doc-meta{font-size:11px;color:var(--wb-muted);display:flex;gap:4px;align-items:center;min-width:0;flex-wrap:wrap}
      .wb-doc-meta b{flex:0 0 auto;white-space:nowrap}
      .wb-doc-meta .wb-badge{white-space:nowrap;flex:0 0 auto}
      .wb-doc-meta .wb-ai-tag{margin-left:auto;height:16px;padding:0 4px;font-size:9px}
      .wb-reports2{display:grid;align-items:start;gap:0}
      .wb-reports-html{flex:1 1 auto;min-height:0;align-items:stretch;grid-auto-rows:minmax(0,1fr)}
      .wb-report-detail-html{min-height:0;overflow:hidden}
      .wb-iframe-fill{flex:1 1 auto;height:auto;min-height:360px}
      @media (max-width:900px){.wb-reports2{grid-template-columns:minmax(0,1fr)!important}.wb-reports2 > .wb-split{display:none}}
      .wb-doc-tags{display:flex;gap:4px;flex-wrap:wrap;margin-top:2px}
      .wb-timeline{display:flex;flex-direction:column;gap:6px}
      .wb-tl-row{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px;align-items:center;font-size:12px}
      .wb-tl-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--wb-text)}
      .wb-tl-track{position:relative;height:18px;background:rgba(127,127,127,.1);border-radius:6px;overflow:hidden}
      .wb-tl-bar{position:absolute;top:2px;bottom:2px;background:rgba(59,130,246,.35);border-radius:5px;min-width:4px}
      .wb-tl-fill{position:absolute;top:0;bottom:0;left:0;background:var(--wb-accent);opacity:.75;border-radius:5px}
      .wb-tl-today{position:absolute;top:-2px;bottom:-2px;width:2px;background:#ef4444}
      .wb-tl-axis{position:relative;display:flex;justify-content:space-between;font-size:10px;color:var(--wb-muted);margin-left:160px}
      .wb-tl-today-label{position:absolute;top:-2px;transform:translateX(-50%);color:#ef4444;background:var(--wb-card);padding:0 3px;border-radius:3px;white-space:nowrap}

      .wb-settings{display:flex;flex-direction:column;gap:14px;padding-bottom:4px}
      .wb-settings-body{display:flex;flex-direction:column;margin-top:2px}
      .wb-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      @media (max-width:900px){.wb-settings-grid{grid-template-columns:minmax(0,1fr)}}
      .wb-srow{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 2px;border-top:1px solid var(--wb-border);min-width:0}
      .wb-srow:first-child{border-top:0}
      .wb-srow-text{min-width:0}
      .wb-srow-name{font-size:13px;font-weight:600;color:var(--wb-text)}
      .wb-srow-control{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;min-width:0}
      .wb-switch{position:relative;width:38px;height:22px;border-radius:999px;border:1px solid var(--wb-border-strong);background:var(--wb-surface-3);cursor:pointer;flex:0 0 auto;transition:background .15s ease,border-color .15s ease;padding:0}
      .wb-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:left .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.2)}
      .wb-switch.on{background:var(--wb-primary);border-color:var(--wb-primary)}
      .wb-switch.on::after{left:18px}
      .wb-savebar{position:sticky;bottom:0;z-index:6;display:flex;align-items:center;gap:10px;background:var(--wb-card);border:1px solid var(--wb-border);border-radius:10px;padding:10px 14px;box-shadow:0 -8px 24px rgba(15,23,42,.10);font-size:12px}

      /* ===== 生成周报 / 月报弹窗（严格按 汇总弹窗原型.html） ===== */
      .wb-summary-card{width:min(740px,94vw);padding:0;gap:0;overflow:visible;resize:none}
      .wb-summary-card > .wb-modal-head{padding:18px 24px 0;margin:0}
      .wb-summary-card > .wb-modal-head .wb-card-title{font-size:16px}
      .wb-summary-card > .wb-modal-head .wb-icon-btn{width:32px;height:32px;font-size:20px;color:var(--wb-muted)}
      .wb-summary-body{padding:14px 24px 8px;display:flex;flex-direction:column;gap:14px}
      .wb-summary-card > .wb-row.end{padding:14px 24px 18px;border-top:1px solid var(--wb-border);margin:8px 0 0;position:sticky;bottom:0;z-index:1;background:var(--wb-card);gap:12px}
      .wb-sum-seg{display:inline-flex;background:var(--wb-surface-2);border:1px solid var(--wb-border);border-radius:var(--wb-r-md);padding:3px;align-self:flex-start}
      .wb-sum-seg button{border:0;background:none;padding:5px 18px;border-radius:8px;cursor:pointer;color:var(--wb-muted);font:inherit;font-weight:500}
      .wb-sum-seg button[aria-selected=true]{background:var(--wb-card);color:var(--wb-text);box-shadow:0 1px 3px rgba(0,0,0,.15)}
      .wb-sum-k{font-size:12px;color:var(--wb-muted);display:block;margin-bottom:6px}
      .wb-sum-range{display:flex;align-items:stretch;gap:8px;position:relative}
      .wb-sum-step{width:40px;border:1px solid var(--wb-border-strong);background:var(--wb-card);border-radius:var(--wb-r-md);cursor:pointer;font-size:18px;color:var(--wb-muted)}
      .wb-sum-step:hover{background:var(--wb-surface-2);color:var(--wb-text)}
      .wb-sum-trig{flex:1;display:flex;align-items:center;gap:12px;text-align:left;padding:10px 14px;border:1px solid var(--wb-border-strong);background:var(--wb-card);border-radius:var(--wb-r-md);cursor:pointer;min-width:0;color:var(--wb-text);font:inherit}
      .wb-sum-trig:hover{border-color:var(--wb-primary)}
      .wb-sum-trig[aria-expanded=true]{border-color:var(--wb-primary);box-shadow:0 0 0 3px var(--wb-primary-soft)}
      .wb-sum-trig svg{flex:none;color:var(--wb-muted)}
      .wb-sum-dt{display:flex;flex-direction:column;line-height:1.25;min-width:0}
      .wb-sum-dt small{font-size:12px;color:var(--wb-muted)}
      .wb-sum-dt b{font-size:15px;font-variant-numeric:tabular-nums;white-space:nowrap}
      .wb-sum-arrow{color:var(--wb-muted)}
      .wb-sum-len{margin-left:auto;font-size:12px;background:var(--wb-surface-2);border:1px solid var(--wb-border);border-radius:99px;padding:2px 10px;white-space:nowrap;color:var(--wb-muted)}
      .wb-sum-meta{display:flex;align-items:center;gap:10px;margin-top:8px;font-size:12px;color:var(--wb-muted);flex-wrap:wrap}
      .wb-sum-chip{background:var(--wb-primary-soft);color:var(--wb-primary);border-radius:99px;padding:1px 10px;font-weight:500}
      .wb-sum-link{border:0;background:none;color:var(--wb-primary);cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px;font:inherit}
      .wb-sum-pop{position:absolute;z-index:20;top:calc(100% + 8px);left:0;right:0;background:var(--wb-card);border:1px solid var(--wb-border-strong);border-radius:var(--wb-r-lg);box-shadow:0 24px 64px rgba(15,23,42,.22);overflow:hidden}
      .wb-sum-pbody{display:grid;grid-template-columns:120px minmax(0,1fr)}
      .wb-sum-presets{border-right:1px solid var(--wb-border);padding:10px;display:flex;flex-direction:column;gap:2px;background:var(--wb-surface-2)}
      .wb-sum-presets h4{margin:4px 8px 6px;font-size:12px;color:var(--wb-muted);font-weight:500}
      .wb-sum-presets button{border:0;background:none;text-align:left;padding:6px 10px;border-radius:var(--wb-r-sm);cursor:pointer;font:inherit;color:var(--wb-text)}
      .wb-sum-presets button:hover{background:var(--wb-card)}
      .wb-sum-presets button.on{background:var(--wb-primary-soft);color:var(--wb-primary);font-weight:600}
      .wb-sum-cal{padding:12px 14px 6px;min-width:0}
      .wb-sum-inputs{display:flex;align-items:center;gap:8px;margin-bottom:10px}
      .wb-sum-inputs input{flex:1;min-width:0;border:1px solid var(--wb-border-strong);background:var(--wb-card);color:var(--wb-text);border-radius:var(--wb-r-sm);padding:6px 10px;font:inherit;font-variant-numeric:tabular-nums}
      .wb-sum-inputs span{color:var(--wb-muted)}
      .wb-sum-inputs input.bad{border-color:var(--wb-danger)}
      .wb-sum-err{color:var(--wb-danger);font-size:12px;min-height:18px;margin:0 0 4px}
      .wb-sum-months{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}
      .wb-sum-mon{min-width:0}
      .wb-sum-mt{display:flex;align-items:center;justify-content:space-between;height:28px;font-weight:600;margin-bottom:4px}
      .wb-sum-mt button{border:0;background:none;cursor:pointer;width:28px;height:28px;border-radius:var(--wb-r-sm);color:var(--wb-muted);font-size:16px}
      .wb-sum-mt button:hover{background:var(--wb-surface-2)}
      .wb-sum-mt i{width:28px}
      .wb-sum-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));row-gap:2px}
      .wb-sum-wd{font-size:11px;color:var(--wb-muted);text-align:center;padding:2px 0}
      .wb-sum-d{position:relative;height:32px;padding:0;min-width:0;border:0;background:none;cursor:pointer;font:inherit;font-variant-numeric:tabular-nums;color:var(--wb-text)}
      .wb-sum-d span{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%}
      .wb-sum-d.in{background:var(--wb-primary-soft)}
      .wb-sum-d.s{border-radius:99px 0 0 99px}
      .wb-sum-d.e{border-radius:0 99px 99px 0}
      .wb-sum-d.s.e{border-radius:99px}
      .wb-sum-d.s span,.wb-sum-d.e span{background:var(--wb-primary);color:#fff;font-weight:600}
      .wb-sum-d:hover span{box-shadow:inset 0 0 0 1px var(--wb-primary)}
      .wb-sum-d.out{color:var(--wb-muted);opacity:.55}
      .wb-sum-d.today span{box-shadow:inset 0 0 0 1px var(--wb-border-strong);font-weight:700}
      .wb-sum-d.rep::after{content:"";position:absolute;left:50%;bottom:2px;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:#15803D;z-index:1}
      .wb-sum-d.s.rep::after,.wb-sum-d.e.rep::after{background:#fff}
      .wb-sum-pf{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-top:1px solid var(--wb-border);font-size:12px;color:var(--wb-muted);flex-wrap:wrap}
      .wb-sum-legend{display:flex;align-items:center;gap:6px}
      .wb-sum-legend i{width:6px;height:6px;border-radius:50%;background:#15803D;display:inline-block}
      .wb-sum-pbtns{display:flex;gap:8px}
      .wb-sum-cov{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--wb-muted)}
      .wb-sum-cells{display:flex;gap:3px;flex:0 1 280px}
      .wb-sum-cells i{flex:1;height:8px;border-radius:3px;background:var(--wb-surface-3);max-width:28px}
      .wb-sum-cells i.on{background:#15803D}
      .wb-sum-cells i.fut{background:transparent;border:1px dashed var(--wb-border-strong)}
      .wb-sum-warn{background:rgba(217,119,6,.12);color:#8A5A00;border-radius:var(--wb-r-md);padding:8px 12px;font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .wb-root[data-wb-theme=dark] .wb-sum-warn{color:#F2C879;background:rgba(242,200,121,.12)}
      .wb-sum-res{border:1px solid var(--wb-border-strong);border-radius:var(--wb-r-md);background:var(--wb-card);display:flex;flex-direction:column;min-height:210px}
      .wb-sum-res:focus-within{border-color:var(--wb-primary);box-shadow:0 0 0 3px var(--wb-primary-soft)}
      .wb-sum-rh{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--wb-border);font-size:12px;color:var(--wb-muted);min-height:38px}
      .wb-sum-text{flex:1;border:0;resize:vertical;background:none;color:var(--wb-text);font:inherit;padding:12px;min-height:150px;outline:0;line-height:1.7}
      .wb-sum-tag{display:inline-flex;align-items:center;gap:4px;background:var(--wb-ai-soft);color:var(--wb-ai);border-radius:99px;padding:1px 10px;font-size:12px;font-weight:600}
      .wb-sum-run{display:flex;flex-direction:column;gap:10px;padding:16px 14px;color:var(--wb-ai)}
      .wb-sum-st{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--wb-muted)}
      .wb-sum-st.now{color:var(--wb-ai);font-weight:600;animation:wb-sum-breathe 1.6s ease-in-out infinite}
      .wb-sum-st.done{color:#15803D}
      .wb-sum-pg{height:4px;background:var(--wb-ai-soft);border-radius:4px;overflow:hidden}
      .wb-sum-pg i{display:block;height:100%;background:linear-gradient(90deg,var(--wb-ai),var(--wb-ai-line),var(--wb-ai));background-size:220% 100%;animation:wb-sum-shine 1.6s linear infinite;transition:width .4s}
      @keyframes wb-sum-shine{from{background-position:120% 0}to{background-position:-120% 0}}
      @keyframes wb-sum-breathe{0%,100%{opacity:1}50%{opacity:.55}}
      /* 汇总结果：更大的编辑区 + 实时预览；modal 用 xl 宽度 */
      .wb-summary-card .wb-sum-res{height:clamp(340px,48vh,560px)}
      .wb-summary-card .wb-sum-run{flex:1;justify-content:center}
      .wb-sum-edit{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr);gap:10px;flex:1 1 auto;min-height:0;padding:10px}
      .wb-sum-edit .wb-textarea{height:100%;min-height:0;resize:none}
      .wb-sum-prev{border:1px solid var(--wb-border);border-radius:10px;background:var(--wb-surface-2);padding:10px 12px;overflow:auto;min-height:0}
      .wb-sum-prev .wb-md{font-size:13px}
      @media (max-width:860px){.wb-sum-edit{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr) minmax(0,.65fr)}}
      @media (prefers-reduced-motion:reduce){.wb-sum-st.now,.wb-sum-pg i{animation:none}}
      .wb-sum-nm{font-size:12px;color:var(--wb-muted);min-width:0}
      .wb-sum-nm b{color:var(--wb-text);font-weight:600}
      .wb-sum-btns{display:flex;gap:8px;flex:none}
      .wb-sum-btn{border:1px solid var(--wb-border-strong);background:var(--wb-card);color:var(--wb-text);border-radius:var(--wb-r-md);padding:7px 16px;cursor:pointer;font:inherit;font-weight:500;min-height:36px;display:inline-flex;align-items:center;gap:6px}
      .wb-sum-btn:hover{background:var(--wb-surface-2)}
      .wb-sum-btn-p{background:var(--wb-primary);border-color:var(--wb-primary);color:#fff}
      .wb-sum-btn-ai{background:var(--wb-ai);border-color:var(--wb-ai);color:#fff}
      .wb-sum-btn:disabled{opacity:.45;cursor:not-allowed}
      @media(max-width:760px){.wb-sum-pbody{grid-template-columns:1fr}.wb-sum-presets{flex-direction:row;flex-wrap:wrap;border-right:0;border-bottom:1px solid var(--wb-border)}.wb-sum-presets h4{display:none}.wb-sum-months{grid-template-columns:1fr}.wb-sum-mon + .wb-sum-mon{display:none}.wb-summary-card > .wb-row.end{flex-direction:column;align-items:stretch}.wb-sum-btns{justify-content:flex-end}.wb-sum-len{display:none}}

      /* ===== M2 今日页 ===== */
      .wb-toast{padding-right:8px}
      .wb-toast .wb-toast-act{border:0;background:transparent;color:inherit;font:inherit;font-weight:650;text-decoration:underline;text-underline-offset:2px;cursor:pointer;padding:2px 4px;flex:none}
      .wb-toast .wb-toast-close{border:0;background:transparent;color:inherit;opacity:.65;cursor:pointer;font-size:14px;line-height:1;padding:2px 4px;flex:none}
      .wb-toast .wb-toast-close:hover{opacity:1}
      .wb-quick{display:flex;gap:8px;align-items:center;margin:0 0 6px}
      .wb-quick .wb-input{flex:1 1 auto;min-width:0}
      .wb-batchbar{position:sticky;bottom:0;z-index:3;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;padding:9px 10px;border:1px solid var(--wb-border);border-radius:var(--wb-r-md);background:color-mix(in srgb,var(--wb-card) 92%,transparent);backdrop-filter:blur(8px);box-shadow:0 -4px 18px rgba(15,23,42,.06)}
      .wb-todo{position:relative}
      .wb-todo .wb-todo-title{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.55}
      .wb-todo-acts{display:flex;gap:2px;flex:none;opacity:0;transition:opacity .15s ease}
      .wb-todo:hover .wb-todo-acts,.wb-todo:focus-within .wb-todo-acts,.wb-todo.selected .wb-todo-acts{opacity:1}
      @media (hover:none){.wb-todo-acts{opacity:1}}
      .wb-todo.flash{animation:wb-flash 1.5s ease}
      @keyframes wb-flash{0%,55%{background:rgba(37,99,235,.15);border-color:rgba(37,99,235,.45)}100%{background:transparent;border-color:transparent}}
      .wb-check.on,.wb-check.sel.on{background:var(--wb-primary);border-color:var(--wb-primary)}
      .wb-check.on::after,.wb-check.sel.on::after{content:"";position:absolute;left:4px;top:1px;width:5px;height:9px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
      .wb-check.sel{border-style:solid;border-color:var(--wb-primary);border-radius:5px;background:var(--wb-card)}
      .wb-check.sel:hover{border-color:var(--wb-primary)}
      .wb-group-empty{font-size:11px;color:var(--wb-text-3);padding:1px 10px 5px 30px}
      .wb-todo-goal{display:inline-flex;align-items:center;font-size:10px;line-height:1.7;padding:0 7px;border-radius:999px;background:rgba(37,99,235,.08);color:var(--wb-accent);border:1px solid rgba(37,99,235,.2);margin-left:6px}
      .wb-overdue-acts{display:flex;gap:4px;flex:none;align-items:center}
      .wb-ai-panel{border:1px solid var(--wb-ai-line);background:var(--wb-ai-soft);border-radius:var(--wb-r-md);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
      .wb-ai-panel > .wb-row{flex-wrap:wrap}
      .wb-ai-steps{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:11px}
      .wb-ai-step{display:inline-flex;align-items:center;gap:4px;color:var(--wb-text-3);border:1px solid var(--wb-border);border-radius:999px;padding:1px 8px;white-space:nowrap}
      .wb-ai-step.on{color:var(--wb-ai);border-color:var(--wb-ai-line);background:var(--wb-card);font-weight:600}
      .wb-ai-step.ok{color:var(--wb-text-2);border-color:var(--wb-border);background:var(--wb-card)}
      .wb-ai-step .wb-spin{width:9px;height:9px;margin:0;border-width:1.5px}
      .wb-ai-item{display:flex;align-items:center;gap:8px;font-size:12px;min-width:0}
      .wb-ai-item .wb-input{flex:1 1 auto;min-width:0;padding:5px 8px;font-size:12px}
      .wb-progress.ai > i{background:var(--wb-ai)}
      .wb-ai-note{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px;color:var(--wb-text-2);border:1px solid var(--wb-ai-line);background:var(--wb-ai-soft);border-radius:var(--wb-r-md);padding:8px 10px}
      .wb-ai-note.manual{border-color:var(--wb-border);background:var(--wb-surface-2);color:var(--wb-text-2)}
      .wb-datechip.wb-datefield{display:inline-flex;flex:none;width:auto}
      .wb-datechip .wb-date-btn{width:auto;padding:2px 8px;border-radius:999px;font-size:11px;gap:5px;background:var(--wb-card);white-space:nowrap}
      .wb-datechip .wb-date-btn .wb-cal-ic{opacity:.65}
      .wb-hint{font-size:11px;color:var(--wb-text-3);line-height:1.5}
      .wb-divider-label{display:flex;align-items:center;gap:10px;margin:2px 0;font-size:11px;color:var(--wb-text-3)}
      .wb-divider-label::before,.wb-divider-label::after{content:"";flex:1 1 auto;height:1px;background:var(--wb-border)}
      .wb-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;min-height:240px}
      .wb-week-col{display:flex;flex-direction:column;gap:4px;border:1px solid var(--wb-border);border-radius:9px;background:rgba(127,127,127,.04);padding:8px 7px;min-height:240px;text-align:left;color:var(--wb-text);font:inherit;cursor:pointer;min-width:0;overflow:hidden}
      .wb-week-col:hover{border-color:var(--wb-accent)}
      .wb-week-col.today{border-color:var(--wb-primary);background:rgba(37,99,235,.08)}
      .wb-week-col h4{margin:0;font-size:12px;display:flex;align-items:baseline;justify-content:space-between;gap:4px;color:var(--wb-text)}
      .wb-week-col h4 small{font-size:10px;color:var(--wb-text-3);font-weight:400}
      .wb-week-ev{display:block;font-size:10px;line-height:1.6;padding:1px 6px;border-radius:6px;background:var(--wb-card);border:1px solid var(--wb-border);color:var(--wb-text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box;max-width:100%}
      .wb-week-ev.rep{color:var(--wb-accent);border-color:rgba(37,99,235,.28);background:rgba(37,99,235,.07)}
      .wb-week-ev.done{opacity:.6;text-decoration:line-through}
      .wb-week-more{font-size:10px;color:var(--wb-text-3)}
      .wb-report-steps{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:2px}
      .wb-report-step{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--wb-text-3)}
      .wb-report-step b{width:20px;height:20px;border-radius:50%;background:var(--wb-surface-2);color:var(--wb-text-2);font-size:11px;display:inline-flex;align-items:center;justify-content:center}
      .wb-report-step.on{color:var(--wb-text);font-weight:600}
      .wb-report-step.on b{background:var(--wb-primary);color:#fff}
      .wb-report-step.ok b{background:rgba(16,185,129,.16);color:#059669}
      .wb-report-step + .wb-report-step::before{content:"→";color:var(--wb-border-strong);margin-right:2px}
      .wb-srccard{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--wb-border);border-radius:10px;padding:9px 11px;background:var(--wb-card);min-width:0}
      .wb-srccard.sub{margin-left:24px;padding:6px 10px;background:var(--wb-surface-2)}
      .wb-srccard .wb-srccard-body{flex:1 1 auto;min-width:0}
      .wb-srccard b{font-size:12px}
      .wb-srccard .wb-small{color:var(--wb-text-3)}
      .wb-srccard details{margin-top:2px}
      .wb-srccard summary{cursor:pointer;font-size:11px;color:var(--wb-accent)}
      .wb-srccard details .wb-small{white-space:pre-wrap;word-break:break-word;margin-top:4px}
      .wb-edit-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:stretch}
      @media (max-width:860px){.wb-edit-split{grid-template-columns:minmax(0,1fr)}}
      .wb-edit-split .wb-textarea{min-height:260px}
      .wb-preview-pane{border:1px solid var(--wb-border);border-radius:10px;padding:10px 12px;max-height:360px;overflow:auto;background:var(--wb-surface-2);min-height:120px}
      .wb-warnbox{display:flex;align-items:flex-start;gap:8px;border:1px solid rgba(217,119,6,.35);background:rgba(217,119,6,.08);color:var(--wb-text-2);border-radius:var(--wb-r-md);padding:8px 10px;font-size:11px;line-height:1.6}
      .wb-warnbox.ai{border-color:var(--wb-ai-line);background:var(--wb-ai-soft)}
      .wb-warnbox .wb-btn{margin-left:auto}
      .wb-tag-ai{display:inline-flex;align-items:center;gap:4px;font-size:10px;padding:0 7px;border-radius:999px;border:1px solid var(--wb-ai-line);background:var(--wb-ai-soft);color:var(--wb-ai)}
      .wb-sugtag{display:inline-flex;align-items:center;gap:4px;border:1px dashed var(--wb-ai-line);background:var(--wb-ai-soft);color:var(--wb-ai);border-radius:999px;font-size:11px;line-height:1.7;padding:1px 4px 1px 9px;white-space:nowrap;flex:none}
      .wb-sugtag button{border:0;background:transparent;color:inherit;cursor:pointer;padding:0 4px;font:inherit;border-radius:99px}
      .wb-sugtag button:hover{background:var(--wb-card)}
      .wb-sugtag-lv{font-size:10px;border-radius:99px;padding:0 6px;background:var(--wb-card);border:1px solid var(--wb-ai-line);white-space:nowrap}
      .wb-evquote{border-left:3px solid var(--wb-ai-line);padding-left:8px;font-size:11px;color:var(--wb-text-3);line-height:1.6}
      .wb-evquote mark{background:var(--wb-ai-soft);color:var(--wb-ai);border-radius:3px;padding:0 2px}
      .wb-goal-sug{border:1px solid var(--wb-ai-line);border-radius:var(--wb-r-lg);background:var(--wb-ai-soft);padding:10px 12px;display:flex;flex-direction:column;gap:9px;margin-top:2px}
      .wb-goal-sug-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .wb-goal-sug-list{display:flex;flex-direction:column;gap:8px}
      .wb-goal-sug-item{display:flex;flex-direction:column;gap:5px;border-top:1px solid var(--wb-border);padding-top:8px}
      .wb-goal-sug-item:first-child{border-top:0;padding-top:0}
      .wb-goal-sug-analysis{display:flex;flex-direction:column;gap:6px;padding:9px 10px;border:1px solid var(--wb-border);border-radius:var(--wb-r-md);background:var(--wb-card);font-size:12px;color:var(--wb-text-2)}
      .wb-goal-sug-why{display:flex;align-items:flex-start;gap:8px;line-height:1.55}
      .wb-goal-sug-why .wb-cycle-badge,.wb-goal-sug-item .wb-cycle-badge{margin-right:0}
      .wb-goal-sug-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px solid var(--wb-border);padding-top:8px}
      .wb-goal-sug-caret{font-size:10px;opacity:.75}
      .wb-todo-body-scroll{scroll-behavior:smooth}

      /* ===== 今日页：今天吃什么 / 今日运势（feature-c） ===== */
      .wb-lucky-actions{display:flex;gap:8px;margin-left:auto;align-self:center;flex:0 0 auto;flex-wrap:wrap}
      @media(max-width:1100px){.wb-lucky-actions{flex-basis:100%;justify-content:flex-end;margin-left:0}}
      .wb-northstar{padding:16px 18px}
      .wb-ns-head{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
      .wb-ns-main{position:relative;border-radius:12px;overflow:hidden}
      .wb-ns-section{margin:14px 0}
      .wb-ns-label{font-size:11px;color:var(--wb-text-3);letter-spacing:.04em;margin-bottom:4px}
      .wb-ns-text{font-size:14px;line-height:1.8;white-space:pre-wrap;color:var(--wb-text)}
      .wb-ns-identity{padding:8px 0;border-bottom:1px dashed var(--wb-border)}
      .wb-ns-evidence{margin-top:4px;padding:0;border:0;background:transparent;color:var(--wb-accent);font-size:11px;cursor:pointer}
      .wb-ns-evlist{margin-top:4px;padding:4px 0 2px 10px;border-left:2px solid var(--wb-border);display:flex;flex-direction:column;gap:3px}
      .wb-ns-blurred{filter:blur(7px);user-select:none;pointer-events:none}
      .wb-ns-veil{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--wb-text-2);background:rgba(127,127,127,.06);border-radius:12px;cursor:pointer}
      .wb-ns-foot{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:10px;border-top:1px solid var(--wb-border);font-size:11px;color:var(--wb-text-3)}
      .wb-ns-intro p{font-size:13px;line-height:1.8;color:var(--wb-text-2);margin:0 0 8px}
      .wb-ns-question{font-size:12px;color:var(--wb-text-2);margin:2px 0 6px}
      .wb-ns-history-list{display:flex;flex-direction:column;gap:4px}
      .wb-ns-history-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--wb-border);border-radius:9px;background:transparent;text-align:left;cursor:pointer}
      .wb-ns-history-item:hover{background:rgba(127,127,127,.06)}
      .wb-ns-history-doc{margin:0;padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.06);font-size:11px;line-height:1.7;white-space:pre-wrap;max-height:420px;overflow:auto}
      .wb-diff-add{background:rgba(34,197,94,.14)}
      .wb-diff-del{background:rgba(239,68,68,.14);text-decoration:line-through}
      .wb-ns-strip{display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:10px;border:1px solid var(--wb-border);border-radius:10px;background:rgba(127,127,127,.03);flex-wrap:wrap}
      .wb-ns-strip-label{font-size:11px;color:var(--wb-text-3)}
      .wb-ns-strip-text{font-size:12px;color:var(--wb-text-2)}
      .wb-ns-strip-text.blurred{filter:blur(5px);user-select:none}
      .wb-ns-guide{display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:10px;border:1px dashed var(--wb-border);border-radius:12px;background:rgba(127,127,127,.03);flex-wrap:wrap}
      .wb-privacy-preview{margin:6px 0 4px;padding:8px 10px;border-radius:8px;background:rgba(127,127,127,.06)}
      .wb-privacy-text{margin:4px 0 0;font-size:11px;line-height:1.6;white-space:pre-wrap;max-height:140px;overflow:auto}
      .wb-privacy-note{margin-top:6px;font-size:11px;color:var(--wb-text-3)}
      .wb-lever-card{padding:12px 14px}
      .wb-lever-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
      .wb-lever-title-wrap{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .wb-lever-single{font-size:11px;color:var(--wb-text-3)}
      .wb-lever-list{display:flex;flex-direction:column;gap:2px}
      .wb-lever-row{display:flex;align-items:flex-start;gap:9px;padding:7px 8px;border-radius:9px;transition:background .15s ease}
      .wb-lever-row:hover{background:rgba(127,127,127,.06)}
      .wb-lever-title{font-size:13px;font-weight:600;line-height:1.5;color:var(--wb-text)}
      .wb-lever-row.done .wb-lever-title{text-decoration:line-through;color:var(--wb-muted);font-weight:500}
      .wb-lever-goal{font-size:11px;color:var(--wb-text-3);margin-top:2px}
      .wb-lever-pending{display:flex;flex-direction:column;gap:8px}
      .wb-lever-cands{display:flex;flex-direction:column;gap:4px}
      .wb-lever-cand{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline;font-size:12px;line-height:1.6}
      .wb-lever-cand-title{font-weight:600}
      .wb-lever-cand-goal{color:var(--wb-text-3);font-size:11px}
      .wb-lever-reason{color:var(--wb-text-3);font-size:11px}
      .wb-lever-pool{display:flex;flex-direction:column;gap:6px;max-height:360px;overflow:auto}
      .wb-lever-pick{display:flex;align-items:flex-start;gap:9px;padding:8px;border:1px solid var(--wb-border);border-radius:10px}
      .wb-lever-pick.on{border-color:var(--wb-accent);background:rgba(59,130,246,.06)}
      .wb-lever-pick.locked{opacity:.7;background:rgba(127,127,127,.04)}
      .wb-lever-tag{display:inline-block;margin-left:6px;font-size:10px;color:var(--wb-warn,#B45309);background:rgba(180,83,9,.10);border-radius:999px;padding:1px 7px;font-weight:500}
      @keyframes wb-lever-pop{0%{transform:scale(1)}35%{transform:scale(1.015)}100%{transform:scale(1)}}
      .wb-lever-row.just-done{animation:wb-lever-pop .6s ease}
      @media(prefers-reduced-motion:reduce){.wb-lever-row.just-done{animation:none}}
      .wb-lucky-content{display:flex;flex-direction:column;gap:10px}
      .wb-lucky-content .wb-chip:disabled,.wb-lucky-content .wb-seg button:disabled{opacity:.5;cursor:not-allowed}
      .wb-lucky-sub{font-size:12px;color:var(--wb-muted);font-weight:400}
      .wb-lucky-foot{font-size:11px;color:var(--wb-text-3);text-align:center;line-height:1.5}
      .wb-lucky-tip{min-height:42px;text-align:center;font-size:13px;color:var(--wb-text-2);padding:2px 8px}
      .wb-lucky-tip b{display:block;font-size:15px;color:var(--wb-text);margin-bottom:2px}
      .wb-lucky-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px;color:var(--wb-muted)}
      .wb-lucky-fade{animation:wb-lucky-fade .4s ease-out}
      @keyframes wb-lucky-fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .wb-lucky-reel{position:relative;height:150px;border-radius:12px;background:var(--wb-surface-2);overflow:hidden;margin:4px 0}
      .wb-lucky-reel::before,.wb-lucky-reel::after{content:"";position:absolute;left:0;right:0;height:50px;z-index:2;pointer-events:none}
      .wb-lucky-reel::before{top:0;background:linear-gradient(var(--wb-surface-2),transparent)}
      .wb-lucky-reel::after{bottom:0;background:linear-gradient(transparent,var(--wb-surface-2))}
      .wb-lucky-band{position:absolute;left:12px;right:12px;top:50px;height:50px;border-radius:10px;border:1.5px solid var(--wb-primary);background:var(--wb-card);z-index:1;transition:box-shadow .3s}
      .wb-lucky-band.hit{box-shadow:0 0 0 4px var(--wb-primary-soft)}
      .wb-lucky-strip{position:absolute;left:0;right:0;top:0;z-index:1;will-change:transform}
      .wb-lucky-item{height:50px;display:flex;align-items:center;justify-content:center;gap:10px;font-size:18px;font-weight:600;color:var(--wb-text-3);position:relative}
      .wb-lucky-item .em{font-size:22px}
      .wb-lucky-item.final.hit{color:var(--wb-text);animation:wb-lucky-pop .5s cubic-bezier(.2,1.6,.4,1)}
      @keyframes wb-lucky-pop{0%{transform:scale(.8)}100%{transform:scale(1)}}
      .wb-lucky-cover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;color:var(--wb-text-3);z-index:3;background:var(--wb-surface-2)}
      .wb-lucky-cover b{font-size:34px;line-height:1}
      .wb-lucky-spark{position:absolute;left:50%;top:75px;width:0;height:0;z-index:4}
      .wb-lucky-spark i{position:absolute;width:6px;height:6px;border-radius:50%;background:var(--c);animation:wb-lucky-fly .8s ease-out forwards}
      @keyframes wb-lucky-fly{from{transform:translate(0,0) scale(1);opacity:1}to{transform:translate(var(--x),var(--y)) scale(.3);opacity:0}}
      .wb-lucky-tubewrap{height:200px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative}
      .wb-lucky-tube{transform-origin:50% 100%}
      .wb-lucky-tube.shake{animation:wb-lucky-shake .16s linear 8}
      @keyframes wb-lucky-shake{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(5deg)}}
      .wb-lucky-stick{transition:transform .7s cubic-bezier(.2,.9,.3,1.2)}
      .wb-lucky-stick.up{transform:translateY(-34px)}
      .wb-lucky-card{--wb-lucky-paper:#FFFBF0;--wb-lucky-paper-2:#FFF5DD;--wb-lucky-ink:#3B2F1B;--wb-lucky-ink-2:#5B4A2B;--wb-lucky-ink-3:#6B5A3A;--wb-lucky-line:#E7D3A8;--wb-lucky-seal:#C0392B;--wb-lucky-chip:#FFFDF6;--wb-lucky-chip-line:#E0C88F;position:relative;border:1px solid var(--wb-lucky-line);background:linear-gradient(var(--wb-lucky-paper),var(--wb-lucky-paper-2));border-radius:14px;padding:18px 20px 16px;text-align:center;color:var(--wb-lucky-ink);animation:wb-lucky-card-in .6s cubic-bezier(.2,1.2,.3,1)}
      .wb-root[data-wb-theme=dark] .wb-lucky-card{--wb-lucky-paper:#2A2418;--wb-lucky-paper-2:#221D13;--wb-lucky-ink:#F3E7CE;--wb-lucky-ink-2:#D9C9A8;--wb-lucky-ink-3:#BDAE90;--wb-lucky-line:#5A4A2E;--wb-lucky-seal:#E8776A;--wb-lucky-chip:#2F2818;--wb-lucky-chip-line:#6B5836}
      @keyframes wb-lucky-card-in{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}
      .wb-lucky-level{display:inline-block;border:2px solid var(--wb-lucky-seal);color:var(--wb-lucky-seal);border-radius:8px;padding:2px 12px;font-weight:800;font-size:18px;letter-spacing:3px;transform:rotate(-4deg);font-family:"Songti SC","STSong",serif}
      .wb-lucky-poem{font-family:"Songti SC","STSong",serif;font-size:20px;line-height:1.9;letter-spacing:2px;margin:12px 0 8px}
      .wb-lucky-sep{height:1px;background:var(--wb-lucky-line);margin:8px 24px}
      .wb-lucky-reading{font-size:13px;line-height:1.7;color:var(--wb-lucky-ink-2);margin:6px 4px}
      .wb-lucky-yi{display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:12px;color:var(--wb-lucky-ink-3)}
      .wb-lucky-yi-tag{border:1px solid var(--wb-lucky-chip-line);border-radius:99px;padding:1px 9px;background:var(--wb-lucky-chip)}
      .wb-lucky-lucky{font-size:12px;color:var(--wb-lucky-ink-3);margin-top:8px}
      .wb-lucky-fan{display:flex;justify-content:center;align-items:flex-end;height:170px;padding-top:10px}
      .wb-lucky-back{width:70px;height:116px;margin:0 -10px;border-radius:9px;border:2px solid #C4B5FD;background:repeating-linear-gradient(45deg,#4C1D95 0 6px,#5B21B6 6px 12px);color:#DDD6FE;font-size:22px;cursor:pointer;transform:rotate(var(--r)) translateY(var(--y));transition:transform .25s,opacity .4s;display:flex;align-items:center;justify-content:center;padding:0}
      .wb-lucky-back:hover:not(:disabled),.wb-lucky-back:focus-visible{transform:rotate(var(--r)) translateY(calc(var(--y) - 14px));outline:0;box-shadow:0 0 0 3px rgba(196,181,253,.6)}
      .wb-lucky-back.dim{opacity:0;pointer-events:none}
      .wb-lucky-back.chosen{transform:translateY(-20px) scale(1.12)}
      .wb-lucky-tarot{display:flex;gap:16px;align-items:center;padding:6px 2px}
      .wb-lucky-tarot.flip .wb-lucky-tcard{animation:wb-lucky-flip .7s ease-out}
      @keyframes wb-lucky-flip{from{transform:rotateY(90deg) scale(.9)}to{transform:none}}
      .wb-lucky-tcard{--wb-lucky-tpaper:#FBF8FF;--wb-lucky-tpaper-2:#EEE7FF;--wb-lucky-tink:#4C1D95;flex:none;width:112px;height:184px;border-radius:12px;border:2px solid #C4B5FD;background:linear-gradient(var(--wb-lucky-tpaper),var(--wb-lucky-tpaper-2));display:flex;flex-direction:column;align-items:center;justify-content:space-between;padding:10px 6px;box-shadow:0 6px 18px rgba(76,29,149,.18);color:var(--wb-lucky-tink);font-family:"Songti SC","STSong",serif}
      .wb-root[data-wb-theme=dark] .wb-lucky-tcard{--wb-lucky-tpaper:#2A2140;--wb-lucky-tpaper-2:#211A33;--wb-lucky-tink:#E9DDFF}
      .wb-lucky-tr{font-size:12px;letter-spacing:2px}
      .wb-lucky-te{font-size:56px;line-height:1}
      .wb-lucky-tn{font-size:16px;font-weight:700;letter-spacing:2px}
      .wb-lucky-tbody{flex:1;min-width:0}
      .wb-lucky-tkw{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:4px}
      .wb-lucky-tag{border:1px solid var(--wb-ai-line);background:var(--wb-ai-soft);color:var(--wb-ai);border-radius:99px;padding:0 8px;font-size:11px}
      .wb-lucky-advice{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:4px;font-size:12px;color:var(--wb-text-2)}
      .wb-lucky-tarot .wb-lucky-reading{text-align:left;color:var(--wb-text-2)}
      .wb-lucky-signs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
      .wb-lucky-sign{border:1px solid var(--wb-border);background:var(--wb-card);border-radius:10px;padding:6px 2px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:0;font:inherit;color:var(--wb-text)}
      .wb-lucky-sign b{font-size:18px;line-height:1.3}
      .wb-lucky-sign span{font-size:12px;font-weight:600}
      .wb-lucky-sign i{font-style:normal;font-size:10px;color:var(--wb-text-3)}
      .wb-lucky-sign:hover{border-color:var(--wb-accent)}
      .wb-lucky-sign.on{border-color:var(--wb-primary);background:var(--wb-primary-soft)}
      .wb-lucky-sign:focus-visible{outline:2px solid var(--wb-primary);outline-offset:2px}
      .wb-lucky-horo{border:1px solid var(--wb-border);border-radius:12px;padding:12px 14px;margin-top:10px;background:var(--wb-surface-2)}
      .wb-lucky-sh{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
      .wb-lucky-sh b{font-size:15px}
      .wb-lucky-st{font-size:13px;line-height:1.7;margin:6px 0 8px}
      .wb-lucky-rate{display:grid;grid-template-columns:34px 76px minmax(0,1fr);gap:6px;align-items:baseline;font-size:12px;margin:3px 0}
      .wb-lucky-stars{color:#F59E0B;letter-spacing:1px;white-space:nowrap}
      .wb-root[data-wb-theme=dark] .wb-lucky-stars{color:#FBBF24}
      .wb-lucky-rt{color:var(--wb-text-2)}
      @media(prefers-reduced-motion:reduce){
        .wb-lucky-tube.shake,.wb-lucky-item.final.hit,.wb-lucky-card,.wb-lucky-spark i,.wb-lucky-fade,.wb-lucky-tarot.flip .wb-lucky-tcard{animation:none!important}
        .wb-lucky-stick{transition:none}
      }
    `

    function reportClientError(error, info) {
      if (!DEBUG_ENABLED) return
      try {
        const payload = {
          message: String(error?.message ?? error ?? 'unknown'),
          stack: String(error?.stack ?? info?.componentStack ?? '').slice(0, 2000),
          url: typeof location !== 'undefined' ? location.href : '',
        }
        fetch('/api/zhixing/debug/client-error', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
        }).catch(() => {})
      } catch { /* 忽略 */ }
    }

    class PanelBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error, info) { reportClientError(error, info) }
      render() {
        if (!this.state.error) return this.props.children
        return h('div', { className: 'wb-root', style: { padding: 24, display: 'block' } },
          h('div', { className: 'wb-card' },
            h('div', { className: 'wb-card-title' }, '知行渲染出错'),
            h('div', { className: 'wb-small', style: { marginTop: 8 } }, String(this.state.error?.message ?? this.state.error)),
            h('div', { className: 'wb-row', style: { marginTop: 10 } },
              h('button', { className: 'wb-btn primary', onClick: () => location.reload() }, '重新加载页面'),
              h('button', { className: 'wb-btn', onClick: () => this.setState({ error: null }) }, '重试'),
            ),
            h('div', { className: 'wb-small wb-muted', style: { marginTop: 8 } }, '错误已写入 log.md，可反馈给开发者。'),
          ))
      }
    }

    function WorkBuddyRoot() {
      return h(PanelBoundary, null, h(WorkBuddyPanel))
    }

    function WbStyles() {
      return h('style', null, CSS)
    }

    async function request(path, payload, options) {
      const init = payload === undefined
        ? { method: 'GET' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
      if (options?.signal) init.signal = options.signal
      const response = await fetch(`${API}${path}`, init)
      const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }))
      if (!response.ok || data.ok === false) throw new Error(data.error || `HTTP ${response.status}`)
      return data
    }

    function toBase64(buffer) {
      const bytes = new Uint8Array(buffer)
      let binary = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
      return btoa(binary)
    }

    function minutesOf(hhmm) {
      const [h, m] = String(hhmm ?? '').split(':').map(Number)
      if (!Number.isFinite(h) || !Number.isFinite(m)) return null
      return h * 60 + m
    }

    const WB_LIGHT_VARS = {
      '--wb-bg': '#F7F7F5', '--wb-card': '#FFFFFF', '--wb-text': '#1F2937', '--wb-muted': '#6B7280',
      '--wb-accent': '#2563EB', '--wb-border': '#E5E7EB', '--wb-primary': '#2563EB',
      '--wb-primary-soft': '#EFF6FF', '--wb-ai': '#6D28D9', '--wb-ai-soft': '#F3EEFF', '--wb-ai-line': '#C4B5FD',
      '--wb-text-2': '#4B5563', '--wb-text-3': '#6B7280', '--wb-surface-2': '#F3F4F6', '--wb-surface-3': '#E5E7EB',
      '--wb-border-strong': '#D1D5DB', '--wb-danger': '#DC2626',
      '--wb-shadow': '0 1px 2px rgba(15,23,42,.06),0 4px 16px rgba(15,23,42,.06)',
    }
    const WB_DARK_VARS = {
      '--wb-bg': '#141414', '--wb-card': '#1C1C1E', '--wb-text': '#EDEDED', '--wb-muted': '#A1A1AA',
      '--wb-accent': '#2563EB', '--wb-border': 'rgba(255,255,255,.10)', '--wb-primary': '#2563EB',
      '--wb-primary-soft': 'rgba(37,99,235,.20)', '--wb-ai': '#6D28D9', '--wb-ai-soft': 'rgba(167,139,250,.14)', '--wb-ai-line': '#7C3AED',
      '--wb-text-2': '#D4D4D8', '--wb-text-3': '#A1A1AA', '--wb-surface-2': '#26262A', '--wb-surface-3': '#34343A',
      '--wb-border-strong': 'rgba(255,255,255,.18)', '--wb-danger': '#F87171',
      '--wb-shadow': '0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35)',
    }

    function detectHostDark() {
      if (typeof document === 'undefined') return false
      const html = document.documentElement
      const body = document.body
      const flagged = (element) => Boolean(element?.hasAttribute?.('data-ds-dark-theme')
        || element?.getAttribute?.('data-ds-theme') === 'dark'
        || element?.getAttribute?.('data-ds-theme-source') === 'dark')
      if (flagged(html) || flagged(body)) return true
      try {
        const parse = (color) => {
          const match = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(String(color ?? ''))
          if (!match) return null
          return { luminance: (Number(match[1]) + Number(match[2]) + Number(match[3])) / 3, alpha: match[4] === undefined ? 1 : Number(match[4]) }
        }
        for (let element = body ?? html; element; element = element.parentElement) {
          const parsed = parse(getComputedStyle(element).backgroundColor)
          if (parsed && parsed.alpha > 0.02) return parsed.luminance < 110
        }
        const scheme = getComputedStyle(body ?? html).colorScheme || getComputedStyle(html).colorScheme || ''
        if (scheme.includes('dark')) return true
      } catch { /* 忽略 */ }
      return false
    }

    function computeTheme(settings, hostDark, systemDark, now) {
      const mode = settings?.themeMode ?? 'host'
      if (mode === 'light') return 'light'
      if (mode === 'dark') return 'dark'
      if (mode === 'system') return systemDark ? 'dark' : 'light'
      if (mode === 'manual') return settings?.themeManual === 'dark' ? 'dark' : 'light'
      if (mode === 'time') {
        const start = minutesOf(settings?.themeLightStart ?? '07:00') ?? 420
        const end = minutesOf(settings?.themeLightEnd ?? '19:00') ?? 1140
        const current = now.getHours() * 60 + now.getMinutes()
        const isLight = start <= end ? (current >= start && current < end) : (current >= start || current < end)
        return isLight ? 'light' : 'dark'
      }
      return hostDark ? 'dark' : 'light'
    }

    function useTheme(settings) {
      const [hostDark, setHostDark] = useState(() => detectHostDark())
      const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : false)
      const [, setTick] = useState(0)
      useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const refresh = () => setHostDark(detectHostDark())
        const observer = new MutationObserver(refresh)
        observer.observe(document.documentElement, { attributes: true })
        if (document.body) observer.observe(document.body, { attributes: true, subtree: false })
        const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
        const onChange = (event) => setSystemDark(event.matches)
        media?.addEventListener?.('change', onChange)
        const timer = setInterval(() => { refresh(); setTick((value) => value + 1) }, 30_000)
        return () => { observer.disconnect(); media?.removeEventListener?.('change', onChange); clearInterval(timer) }
      }, [])
      return computeTheme(settings, hostDark, systemDark, nowInZone())
    }

    function useToast() {
      const [toast, setToast] = useState(null)
      const timer = useRef(null)
      const paused = useRef(false)
      const remain = useRef(4000)
      const show = useCallback((text, kind = 'ok', undo) => {
        const action = typeof undo === 'function' ? undo : null
        const duration = action ? 6000 : 4000
        setToast({ text: String(text), kind, progress: 1, undo: action })
        if (timer.current) clearInterval(timer.current)
        paused.current = false
        remain.current = duration
        let last = Date.now()
        timer.current = setInterval(() => {
          const now = Date.now()
          if (!paused.current) remain.current -= now - last
          last = now
          const progress = Math.max(0, remain.current / duration)
          if (progress <= 0) { clearInterval(timer.current); setToast(null); return }
          setToast((current) => (current ? { ...current, progress } : current))
        }, 100)
      }, [])
      const dismiss = useCallback(() => {
        if (timer.current) clearInterval(timer.current)
        setToast(null)
      }, [])
      const setPaused = useCallback((value) => { paused.current = value }, [])
      useEffect(() => () => { if (timer.current) clearInterval(timer.current) }, [])
      return [toast, show, setPaused, dismiss]
    }

    function renderMarkdown(markdown) {
      const lines = String(markdown ?? '').split(/\r?\n/)
      const out = []
      let list = null
      const inline = (text) => text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => part.startsWith('**') && part.endsWith('**')
        ? h('strong', { key: index }, part.slice(2, -2))
        : part)
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        const heading = /^##\s+(.+)$/.exec(line)
        if (heading) { if (list) { out.push(h('ul', { key: `u${i}` }, list)); list = null } out.push(h('h2', { key: i }, heading[1])); continue }
        const bullet = /^\s*[-*+]\s+(.+)$/.exec(line)
        if (bullet) { list = list ?? []; list.push(h('li', { key: `l${i}` }, inline(bullet[1]))); continue }
        if (list) { out.push(h('ul', { key: `u${i}` }, list)); list = null }
        if (line.trim()) out.push(h('p', { key: i }, inline(line)))
      }
      if (list) out.push(h('ul', { key: 'last' }, list))
      return h('div', { className: 'wb-md' }, out)
    }

    function Progress({ value }) {
      const numeric = Math.max(0, Math.min(100, Number(value) || 0))
      return h('div', { className: `wb-progress${numeric >= 80 ? ' high' : numeric < 30 ? ' low' : ''}` },
        h('i', { style: { width: `${numeric}%` } }))
    }

    function fuzzyMatch(query, text) {
      const q = String(query ?? '').trim().toLowerCase()
      if (!q) return true
      const target = String(text ?? '').toLowerCase()
      if (target.includes(q)) return true
      let index = 0
      for (const char of q) {
        index = target.indexOf(char, index)
        if (index < 0) return false
        index += 1
      }
      return true
    }

    function ModelPicker({ state, refresh, show }) {
      const [open, setOpen] = useState(false)
      const [models, setModels] = useState([])
      const [query, setQuery] = useState('')
      const [collapsed, setCollapsed] = useState({})
      const boxRef = useRef(null)
      const load = useCallback(async () => {
        try { const data = await request('/models'); setModels(data.models ?? []) }
        catch { /* 静默失败，仍显示跟随 */ }
      }, [])
      useEffect(() => { void load() }, [load])
      useEffect(() => {
        const onDown = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false) }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [])
      const override = state.modelOverride
      const currentLabel = override
        ? `${override.provider} / ${override.model}${override.reasoningEffort ? ` · ${override.reasoningEffort}` : ''}`
        : `跟随 Harness · ${state.model ?? '未知'}`
      const groups = useMemo(() => {
        const map = new Map()
        for (const model of models) {
          const haystack = `${model.name} ${model.model} ${model.provider} ${model.providerName}`
          if (!fuzzyMatch(query, haystack)) continue
          const key = model.provider
          if (!map.has(key)) map.set(key, { provider: model.provider, providerName: model.providerName || model.provider, models: [] })
          map.get(key).models.push(model)
        }
        return [...map.values()]
      }, [models, query])
      const choose = async (value) => {
        setOpen(false)
        try {
          if (!value) await request('/settings', { settings: { modelOverride: null } })
          else {
            const [route, effort] = value.split('#')
            const [provider, ...rest] = route.split('/')
            await request('/settings', { settings: { modelOverride: { provider, model: rest.join('/'), ...(effort ? { reasoningEffort: effort } : {}) } } })
          }
          await refresh()
          show('已切换插件使用的模型')
        } catch (error) { show(error.message, 'error') }
      }
      const aiDown = state.ai?.available === false
      const item = (value, label, active, detail, available = !aiDown) => h('button', {
        key: value || 'follow', className: `wb-opt${active ? ' active' : ''}`, onClick: () => choose(value),
      }, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 } },
        h('i', { className: `wb-dot${available ? '' : ' bad'}`, title: available ? '可用' : '不可用' }),
        h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label)),
      detail ? h('small', null, detail) : null)
      return h('div', { className: 'wb-rel', ref: boxRef },
        h('button', { className: 'wb-model-btn', onClick: () => setOpen(!open), title: '切换插件使用的模型' },
          h('i', { className: `wb-dot${state.ai?.available === false ? ' bad' : ''}`, title: state.ai?.available === false ? '当前模型不可用' : '可用' }),
          h('span', null, currentLabel), h('span', { style: { opacity: .6 } }, '▾')),
        open ? h('div', { className: 'wb-pop' },
          h('input', {
            className: 'wb-input', placeholder: '搜索模型 / 渠道', value: query, autoFocus: true,
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Escape') setOpen(false) },
          }),
          h('div', { className: 'wb-pop-list' },
            item('', `跟随 Harness（${state.model ?? '未知'}）`, !override, '当前会话 / 默认模型'),
            groups.map((group) => {
              const isCollapsed = collapsed[group.provider] === true
              return h(React.Fragment, { key: group.provider },
                h('button', {
                  className: 'wb-group-head', onClick: () => setCollapsed({ ...collapsed, [group.provider]: !isCollapsed }),
                },
                  h('span', null, `${group.providerName}（${group.models.length}）`),
                  h('span', null, isCollapsed ? '▸' : '▾')),
                isCollapsed ? null : group.models.map((model) => item(
                  `${model.provider}/${model.model}`,
                  model.name,
                  override && override.provider === model.provider && override.model === model.model,
                  model.model,
                )),
              )
            }),
            groups.length ? null : h('div', { className: 'wb-empty' }, '没有匹配的模型'),
          ),
        ) : null,
      )
    }

    function todayKey() {
      const d = nowInZone()
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    }

    function shiftKey(key, days) {
      const [y, m, d] = key.split('-').map(Number)
      const date = new Date(y, m - 1, d + days)
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    function shiftMonthKey(key, delta) {
      const date = dateOfKey(key) ?? nowInZone()
      return keyOf(new Date(date.getFullYear(), date.getMonth() + delta, 1))
    }

    const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

    function dateOfKey(key) {
      const [y, m, d] = String(key ?? '').split('-').map(Number)
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null
      return new Date(y, m - 1, d)
    }

    function daysBetweenKeys(from, to) {
      const a = parseKey(from); const b = parseKey(to)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
      return Math.round((b - a) / 86_400_000) + 1
    }

    function isoWeekKeyOf(key) {
      const date = dateOfKey(key)
      if (!date) return ''
      const target = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 3 - ((date.getDay() + 6) % 7))
      const firstThursday = new Date(target.getFullYear(), 0, 4)
      const week = 1 + Math.round(((target - firstThursday) / 86_400_000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
      return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`
    }

    function defaultSummaryRange(kind, anchorKey) {
      const base = dateOfKey(anchorKey) ?? nowInZone()
      if (kind === 'month') {
        const from = new Date(base.getFullYear(), base.getMonth(), 1)
        const to = new Date(base.getFullYear(), base.getMonth() + 1, 0)
        return { from: keyOf(from), to: keyOf(to) }
      }
      const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7))
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
      return { from: keyOf(monday), to: keyOf(sunday) }
    }

    /** 2026-11-15 → 明天；11-16 → 11月16日 周一 */
    function friendlyDate(key) {
      const date = dateOfKey(key)
      if (!date) return String(key ?? '')
      const today = todayKey()
      if (key === today) return '今天'
      if (key === shiftKey(today, 1)) return '明天'
      if (key === shiftKey(today, -1)) return '昨天'
      return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`
    }

    function shortDate(key) {
      return String(key ?? '').slice(5).replace('-', '/')
    }
    function rangeDateText(key) {
      const date = dateOfKey(key)
      if (!date) return String(key ?? '')
      return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAYS[date.getDay()]}`
    }


    function aiOffOf(ai) {
      return Boolean(ai && ai.available === false)
    }

    const SUMMARY_AUDIENCES = [
      { key: 'self', label: '自己 · 复盘版', short: '自己' },
      { key: 'team', label: '团队 · 详细版', short: '团队' },
      { key: 'boss', label: '上级 · 简版', short: '上级' },
    ]

    /** 版本标签页上的短名：预置读者用短名，自定义读者原样显示。 */
    function summaryAudienceShort(audience) {
      const text = String(audience ?? '').trim()
      const preset = SUMMARY_AUDIENCES.find((item) => text === item.label || text.startsWith(item.short))
      return preset ? preset.short : text.slice(0, 12)
    }

    function aiReasonOf(ai) {
      return ai?.reason || '当前模型没有响应'
    }

    /** 在原文里把命中的关键词包成 <mark>（不改变原文其余字符）。 */
    function highlightKeyword(text, keyword) {
      const value = String(text ?? '')
      const needle = String(keyword ?? '').trim()
      if (!needle) return value
      const lowerValue = value.toLowerCase()
      const lowerNeedle = needle.toLowerCase()
      const nodes = []
      let cursor = 0
      let index = lowerValue.indexOf(lowerNeedle, cursor)
      let key = 0
      while (index >= 0) {
        if (index > cursor) nodes.push(value.slice(cursor, index))
        nodes.push(h('mark', { key: `mark-${key}` }, value.slice(index, index + needle.length)))
        key += 1
        cursor = index + needle.length
        index = lowerValue.indexOf(lowerNeedle, cursor)
      }
      if (cursor < value.length) nodes.push(value.slice(cursor))
      return nodes.length ? nodes : value
    }

    /** 手写日报的固定骨架：把几句话拆成「今天干了什么」的条目。 */
    function manualReportDraft(text) {
      const lines = String(text ?? '').split(/[\n；;。]+/).map((line) => line.trim()).filter(Boolean)
      return `## 今天干了什么\n${lines.length ? lines.map((line) => `- ${line}`).join('\n') : '- '}\n\n## 明天准备干什么\n- \n\n## 问题与风险\n- `
    }

    function TodoPlusIcon({ size = 13 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M8 3.2v9.6M3.2 8h9.6', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }))
    }

    function SparkIcon({ size = 14 }) {
      return h('svg', { viewBox: '0 0 20 20', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M10 2.4l1.7 4.2 4.2 1.7-4.2 1.7L10 14.2 8.3 10 4.1 8.3 8.3 6.6 10 2.4z', fill: 'currentColor' }),
        h('path', { d: 'M15.6 12.6l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8.8-1.9z', fill: 'currentColor', opacity: .85 }))
    }

    function EditIcon({ size = 13 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M10.9 2.6l2.5 2.5L5.8 12.7l-3.2.7.7-3.2 7.6-7.6z', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }))
    }

    function TrashIcon({ size = 13 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M3.2 4.4h9.6M6.2 4.4V2.9h3.6v1.5M4.4 4.4l.6 8.2h6l.6-8.2M6.6 7v3.4M9.4 7v3.4', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function RefreshIcon({ size = 13 }) {
      return h('svg', { viewBox: '0 0 16 16', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.4h-2.4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function Spinner() {
      return h('span', { className: 'wb-spin' })
    }

    async function quickAddTodo(text, source) {
      const data = await request('/todos/quick-add', { text, source })
      return data.todo
    }

    function useOverlayToast() {
      const [toast, setToast] = useState(null)
      const timer = useRef(null)
      const show = useCallback((message, error = false, undo = null) => {
        const action = typeof undo === 'function' ? undo : null
        setToast({ message: String(message), error, undo: action })
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setToast(null), action ? 6000 : error ? 6000 : 3600)
      }, [])
      useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
      const node = toast === null ? null : h('div', { className: `wb-qtoast${toast.error ? ' error' : ''}`, role: 'status' },
        h('span', null, toast.error ? '⚠' : '✓'),
        h('span', { style: { flex: 1 } }, toast.message),
        toast.undo ? h('button', {
          type: 'button', style: { border: 0, background: 'transparent', color: 'inherit', font: 'inherit', fontWeight: 650, textDecoration: 'underline', cursor: 'pointer', padding: 0 },
          onClick: async () => {
            try { await toast.undo(); setToast(null) } catch { /* 忽略 */ }
          },
        }, '撤销') : null)
      return [node, show]
    }

    function QuickTodoLayer() {
      const [selection, setSelection] = useState(null)
      const [menu, setMenu] = useState(null)
      const [busy, setBusy] = useState(false)
      const [toastNode, showToast] = useOverlayToast()

      useEffect(() => {
        const update = () => {
          const sel = window.getSelection()
          if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setSelection(null); return }
          const text = sel.toString().trim()
          if (text.length < 2) { setSelection(null); return }
          const anchor = sel.anchorNode
          const element = anchor instanceof Element ? anchor : anchor?.parentElement
          if (element?.closest('input,textarea,[contenteditable="true"],.wb-root')) { setSelection(null); return }
          const range = sel.getRangeAt(0)
          const rect = range.getBoundingClientRect()
          if (rect.width === 0 && rect.height === 0) { setSelection(null); return }
          setSelection({ text, rect })
        }
        const hide = () => setSelection(null)
        document.addEventListener('selectionchange', update)
        document.addEventListener('mouseup', update, true)
        document.addEventListener('keyup', update, true)
        window.addEventListener('scroll', hide, true)
        return () => {
          document.removeEventListener('selectionchange', update)
          document.removeEventListener('mouseup', update, true)
          document.removeEventListener('keyup', update, true)
          window.removeEventListener('scroll', hide, true)
        }
      }, [])

      useEffect(() => {
        const onContext = (event) => {
          const target = event.target instanceof Element ? event.target : event.target?.parentElement
          const row = target?.closest('[class*="userRow"]')
          const selected = window.getSelection()?.toString().trim() ?? ''
          const text = row ? (row.innerText || '').trim() : selected
          if (!text || text.length < 2) return
          event.preventDefault()
          setMenu({
            x: Math.min(event.clientX, window.innerWidth - 210),
            y: Math.min(event.clientY, window.innerHeight - 130),
            text,
            source: row ? '快捷添加（我的消息）' : '快捷添加（选区）',
          })
          setSelection(null)
        }
        const close = (event) => {
          if (event.target instanceof Element && event.target.closest('.wb-qmenu')) return
          setMenu(null)
        }
        document.addEventListener('contextmenu', onContext, true)
        document.addEventListener('pointerdown', close, true)
        window.addEventListener('blur', close)
        return () => {
          document.removeEventListener('contextmenu', onContext, true)
          document.removeEventListener('pointerdown', close, true)
          window.removeEventListener('blur', close)
        }
      }, [])

      const save = async (text, source) => {
        setBusy(true)
        try {
          const todo = await quickAddTodo(text, source)
          showToast(`已加入搭子待办：${todo.content}`, false, async () => {
            await request('/todos/delete', { id: todo.id })
            showToast('已撤销加入')
          })
          setMenu(null)
        } catch (error) {
          showToast(`加入失败：${error instanceof Error ? error.message : String(error)}`, true)
        } finally {
          setBusy(false)
        }
      }

      let button = null
      if (selection && !menu) {
        const rect = selection.rect
        // 与「存入知识图谱」并排：它固定按选区中心 - 70 定位，这里贴到它右侧；放不下就贴左侧。
        const kgLeft = Math.max(8, Math.min(window.innerWidth - 150, rect.left + rect.width / 2 - 70))
        const kgWidth = 120
        const selfWidth = 92
        let left = kgLeft + kgWidth + 8
        if (left + selfWidth > window.innerWidth - 8) left = Math.max(8, kgLeft - selfWidth - 8)
        const top = Math.max(8, rect.top - 38)
        button = h('button', {
          className: 'wb-qbtn', type: 'button', title: '加入搭子待办', disabled: busy,
          style: { left, top },
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => save(selection.text, '快捷添加（选区）'),
        }, h(TodoPlusIcon, { size: 13 }), busy ? '添加中…' : '加入待办')
      }

      const menuNode = menu === null ? null : h('div', { className: 'wb-qmenu', role: 'menu', style: { left: menu.x, top: menu.y } },
        h('button', { type: 'button', role: 'menuitem', disabled: busy, onClick: () => save(menu.text, menu.source) }, h(TodoPlusIcon), '加入搭子待办'),
        h('button', { type: 'button', role: 'menuitem', onClick: async () => {
          try { await navigator.clipboard.writeText(menu.text); showToast('已复制') } catch { showToast('复制失败', true) }
          setMenu(null)
        } }, h('span', { style: { width: 13, textAlign: 'center' } }, '⧉'), '复制'))

      return h(React.Fragment, null, h(WbStyles), button, menuNode, toastNode)
    }

    function AssistantTodoAction(props) {
      const { messageId, useChat, sessionId } = props
      const text = useChat((snapshot) => {
        for (const node of snapshot.nodes.values()) {
          if (node.kind !== 'assistant-step') continue
          const data = node.data
          if (data?.finalNode?.messageId !== messageId) continue
          return (data.blocks ?? []).filter((block) => block.kind === 'text').map((block) => block.text).join('\n\n').trim()
        }
        return ''
      })
      const [state, setState] = useState('idle')
      const [toastNode, showToast] = useOverlayToast()
      const save = async () => {
        if (!text.trim() || state === 'busy') return
        setState('busy')
        try {
          const todo = await quickAddTodo(text, '快捷添加（AI 回复）')
          setState('saved')
          showToast(`已加入搭子待办：${todo.content}`, false, async () => {
            await request('/todos/delete', { id: todo.id })
            showToast('已撤销加入')
          })
          setTimeout(() => setState((value) => value === 'saved' ? 'idle' : value), 2600)
        } catch (error) {
          setState('idle')
          showToast(`加入失败：${error instanceof Error ? error.message : String(error)}`, true)
        }
      }
      return h(React.Fragment, null,
        h(WbStyles),
        h('button', {
          type: 'button', className: `wb-action${state === 'saved' ? ' saved' : ''}`, title: '把整条回答加入搭子待办',
          disabled: state === 'busy' || !text.trim(), onClick: save,
          style: {
            display: 'inline-flex', alignItems: 'center', gap: 5, height: 24, border: 0,
            background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 12,
            lineHeight: 1, opacity: state === 'saved' ? 1 : 0.66, padding: '0 6px',
            borderRadius: 7, whiteSpace: 'nowrap', verticalAlign: 'middle', cursor: 'pointer',
            ...(state === 'saved' ? { color: '#10b981' } : {}),
          },
        }, h(TodoPlusIcon, { size: 12 }), state === 'saved' ? '已加入' : state === 'busy' ? '添加中…' : '加入待办'),
        toastNode)
    }

    const EVENING_SNOOZE = ['30 分钟后', '1 小时后', '明天上班时']
    const SNOOZE_STORAGE_KEY = 'wb.notice.snooze'
    const eveningCollectCache = new Map()
    // 稍后提醒 -> 撤销会重挂卡片，用这份页内缓存保住已勾选会话和「补充几句」。
    const eveningNoticeDraft = { date: '', extra: '', selected: null }

    function noticeSessionName(session, index) {
      const first = session.human?.[0] ?? session.assistant?.[0] ?? session.cwd ?? `会话 ${index + 1}`
      return String(first).slice(0, 64)
    }

    /** 晚报提醒：在原卡片上增加素材勾选、生成草稿、稍后提醒（早安卡片不走这里）。 */
    function EveningNoticeCard({ notice, ai, date, completedCount = 0, onClose, onSnooze, onOpenReport }) {
      const off = aiOffOf(ai)
      const [session, setSession] = useState(null)
      const [loading, setLoading] = useState(true)
      const [expanded, setExpanded] = useState(false)
      const [selected, setSelected] = useState(new Set())
      const [extra, setExtra] = useState(() => (eveningNoticeDraft.date === date ? eveningNoticeDraft.extra : ''))
      const [menuOpen, setMenuOpen] = useState(false)
      const menuRef = useRef(null)
      useDismiss(menuRef, () => setMenuOpen(false))
      useEffect(() => {
        let alive = true
        const cached = eveningCollectCache.get(date)
        const rememberSelection = (ids) => {
          eveningNoticeDraft.date = date
          eveningNoticeDraft.selected = [...ids]
          setSelected(new Set(ids))
        }
        const pickSelection = (next) => {
          const ids = (next?.sessions ?? []).map((item) => item.sessionId)
          const wanted = eveningNoticeDraft.date === date && Array.isArray(eveningNoticeDraft.selected) ? eveningNoticeDraft.selected : null
          return wanted ? ids.filter((id) => wanted.includes(id)) : ids
        }
        if (cached) {
          setSession(cached)
          rememberSelection(pickSelection(cached))
          setLoading(false)
          return () => { alive = false }
        }
        setLoading(true)
        request('/collect/sessions', { date })
          .then((result) => {
            if (!alive) return
            const next = result?.session ?? null
            setSession(next)
            if (next) eveningCollectCache.set(date, next)
            rememberSelection(pickSelection(next))
          })
          .catch(() => { if (alive) setSession(null) })
          .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
      }, [date])
      const sessions = session?.sessions ?? []
      const hasMaterial = sessions.length > 0 || completedCount > 0
      const empty = !loading && !hasMaterial
      const bodyText = empty
        ? '今天还没有可以汇总的 AI 会话或已完成待办。可以先写几句话，AI 帮你整理成日报。'
        : `${notice.body}\n${loading
          ? '正在整理今天的素材…'
          : `今天有 ${sessions.length} 段 AI 会话、${completedCount} 项待办已完成。AI 已整理好素材，可以直接生成日报草稿。`}${off ? `\n✦ AI 暂不可用（${aiReasonOf(ai)}），可以直接手写，素材已为你列好。` : ''}`
      const canGenerate = !off && !loading && (selected.size > 0 || completedCount > 0)
      const generateTitle = off
        ? `AI 暂时不可用：${aiReasonOf(ai)}`
        : loading ? '正在整理今天的素材…' : '至少选一段会话或有一项已完成待办'
      const openDraft = () => onOpenReport?.({
        initialStep: 2, initialSessionIds: [...selected], initialExtraText: extra, autoGenerate: true,
      })
      const openManual = () => onOpenReport?.({
        initialStep: 3, initialManual: true, initialExtraText: extra,
      })
      const toggleSession = (id) => setSelected((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id); else next.add(id)
        eveningNoticeDraft.date = date
        eveningNoticeDraft.selected = [...next]
        return next
      })
      const closeCard = () => {
        eveningNoticeDraft.date = ''
        eveningNoticeDraft.extra = ''
        eveningNoticeDraft.selected = null
        onClose?.()
      }
      const materials = expanded && !empty
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8, maxWidth: 760 } },
          sessions.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflow: 'auto' } },
              sessions.map((item, index) => h('div', { key: item.sessionId, className: 'wb-srccard sub', style: { marginLeft: 0 } },
                h('input', {
                  type: 'checkbox', checked: selected.has(item.sessionId),
                  onChange: () => toggleSession(item.sessionId),
                  'aria-label': '选择这段会话',
                }),
                h('div', { className: 'wb-srccard-body' },
                  h('b', { style: { fontWeight: 500 } }, `${index + 1}. ${noticeSessionName(item, index)}`)))))
            : null,
          h('textarea', {
            className: 'wb-textarea', style: { minHeight: 52 }, value: extra,
            placeholder: '补充几句（可选）：没被记录的会议、线下沟通',
            onChange: (event) => {
              const value = event.target.value
              eveningNoticeDraft.date = date
              eveningNoticeDraft.extra = value
              setExtra(value)
            },
          }),
          h('span', { className: 'wb-hint' }, '取消勾选的会话不会发给模型。'))
        : null
      const actionButtons = empty
        ? h('button', { className: 'wb-btn primary sm', onClick: () => onOpenReport?.({ initialStep: 1 }) }, '写几句话开始')
        : off
          ? h(React.Fragment, null,
            h('button', { className: 'wb-btn ai sm', disabled: true, title: generateTitle }, h(SparkIcon), '生成日报草稿'),
            h('button', { className: 'wb-btn primary sm', onClick: openManual }, '直接手写'))
          : h('button', { className: 'wb-btn ai sm', disabled: !canGenerate, title: canGenerate ? '生成日报草稿' : generateTitle, onClick: openDraft },
            h(SparkIcon), '生成日报草稿')
      return h('div', { className: 'wb-notice', role: 'alertdialog', 'aria-live': 'assertive', style: { flexShrink: 0 } },
        h('div', { className: 'wb-notice-title', style: { flex: '0 0 auto' } }, h('span', null, '🔔'), '提醒'),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { className: 'wb-small', style: { fontWeight: 650 } }, notice.title),
          h('div', { className: 'wb-notice-body' }, bodyText),
          empty ? null : h('button', {
            style: {
              border: 0, background: 'none', color: 'var(--wb-primary)', cursor: 'pointer',
              padding: 0, marginTop: 2, fontSize: 11, fontFamily: 'inherit',
            },
            onClick: () => setExpanded(!expanded),
          }, expanded ? '收起素材' : '查看素材'),
          materials),
        h('div', { className: 'wb-notice-foot', style: { flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: 430 } },
          actionButtons,
          h('span', { className: 'wb-rel', ref: menuRef },
            h('button', {
              className: 'wb-btn sm', 'aria-haspopup': 'menu', 'aria-expanded': menuOpen,
              onClick: () => setMenuOpen(!menuOpen),
            }, '稍后提醒 ▾'),
            menuOpen ? h('div', { className: 'wb-export', style: { minWidth: 126 } },
              EVENING_SNOOZE.map((label) => h('button', {
                key: label,
                onClick: () => { setMenuOpen(false); onSnooze?.(label) },
              }, label))) : null),
          h('button', { className: 'wb-icon-btn', 'aria-label': '关闭提醒', title: '今天不再提醒', onClick: closeCard }, '×'),
        ),
      )
    }

    function NoticeCard({ notice, onClose, onViewOverdue, ...rest }) {
      if (notice?.kind === 'evening') return h(EveningNoticeCard, { notice, onClose, ...rest })
      return h('div', { className: 'wb-notice', role: 'alertdialog', 'aria-live': 'assertive' },
        h('div', { className: 'wb-notice-title', style: { flex: '0 0 auto' } }, h('span', null, '🔔'), '提醒'),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { className: 'wb-small', style: { fontWeight: 650 } }, notice.title),
          h('div', { className: 'wb-notice-body' }, notice.body)),
        h('div', { className: 'wb-notice-foot' },
          h('button', {
            className: 'wb-btn sm', onClick: () => {
              onViewOverdue?.()
              onClose?.()
            },
          }, '查看逾期'),
          h('button', { className: 'wb-icon-btn', 'aria-label': '关闭提醒', title: '关闭提醒', onClick: onClose }, '×'),
        ),
      )
    }

    function pad2(n) { return String(n).padStart(2, '0') }

    function keyOf(date) { return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` }

    function DateField({ value, onChange, placeholder = '选择日期', withTime = false, chip = false }) {
      const [open, setOpen] = useState(false)
      const [pos, setPos] = useState(null)
      const [selected, setSelected] = useState(null)
      const [hour, setHour] = useState('09')
      const [minute, setMinute] = useState('00')
      const [view, setView] = useState(() => {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
        return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : nowInZone()
      })
      const boxRef = useRef(null)
      useEffect(() => {
        const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value ?? ''))
        if (match) {
          setView(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
          setSelected(`${match[1]}-${match[2]}-${match[3]}`)
          if (withTime) {
            setHour(match[4] ?? '09')
            setMinute(match[5] ?? '00')
          }
        }
      }, [value, withTime])
      useEffect(() => {
        if (!open) return undefined
        const close = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false) }
        document.addEventListener('mousedown', close)
        return () => document.removeEventListener('mousedown', close)
      }, [open])
      const openMenu = () => {
        const rect = boxRef.current?.getBoundingClientRect()
        const width = 258
        const left = rect ? Math.min(Math.max(8, rect.left), window.innerWidth - width - 12) : 8
        const below = rect ? rect.bottom + 6 : 80
        const height = withTime ? 392 : 336
        const top = (rect && below + height < window.innerHeight) ? below : Math.max(8, (rect?.top ?? 80) - height - 6)
        setPos({ left, top })
        setOpen(true)
      }
      const year = view.getFullYear()
      const month = view.getMonth()
      const first = new Date(year, month, 1)
      const startOffset = (first.getDay() + 6) % 7
      const days = []
      for (let i = 0; i < 42; i += 1) days.push(new Date(year, month, 1 - startOffset + i))
      const today = keyOf(nowInZone())
      const currentDate = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ''))?.[1] ?? ''
      const commit = (key, hh = hour, mm = minute) => {
        setSelected(key)
        if (withTime) onChange(`${key} ${hh}:${mm}`)
        else { onChange(key); setOpen(false) }
      }
      const display = (() => {
        const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value ?? ''))
        if (!match) return ''
        return withTime && match[4] ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : `${match[1]}-${match[2]}-${match[3]}`
      })()
      const label = chip && /^\d{4}-\d{2}-\d{2}/.test(String(value ?? ''))
        ? `${friendlyDate(String(value).slice(0, 10))}${withTime ? ` ${String(value).slice(11, 16)}` : ''}`
        : (display || placeholder)
      return h('div', { className: `wb-datefield${chip ? ' wb-datechip' : ''}`, ref: boxRef },
        h('button', {
          type: 'button', className: `wb-date-btn${display ? '' : ' empty'}`, title: display || placeholder,
          'aria-haspopup': 'dialog', 'aria-expanded': open,
          onClick: () => (open ? setOpen(false) : openMenu()),
        },
          chip
            ? h('svg', { viewBox: '0 0 16 16', width: 11, height: 11, fill: 'none', 'aria-hidden': true, className: 'wb-cal-ic' },
              h('rect', { x: 2.2, y: 3, width: 11.6, height: 10, rx: 2, stroke: 'currentColor', strokeWidth: 1.4 }),
              h('path', { d: 'M2.4 6.2h11.2M5.4 1.8v2.4M10.6 1.8v2.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
            : null,
          h('span', null, label), chip ? null : h('span', { style: { opacity: .5 } }, '▾')),
        open && pos ? h('div', { className: 'wb-cal', style: { left: pos.left, top: pos.top } },
          h('div', { className: 'wb-cal-head' },
            h('button', { className: 'wb-cal-nav', onClick: () => setView(new Date(year, month - 1, 1)) }, '‹'),
            h('div', { className: 'wb-cal-title' }, `${year} 年 ${month + 1} 月`),
            h('button', { className: 'wb-cal-nav', onClick: () => setView(new Date(year, month + 1, 1)) }, '›'),
            h('div', { className: 'wb-spacer' }),
            h('button', { className: 'wb-cal-nav', title: '回到今天', onClick: () => setView(nowInZone()) }, '◎'),
          ),
          h('div', { className: 'wb-cal-week' }, ['一', '二', '三', '四', '五', '六', '日'].map((day) => h('span', { key: day }, day))),
          h('div', { className: 'wb-cal-grid' },
            days.map((date, index) => {
              const key = keyOf(date)
              return h('button', {
                key: `${key}-${index}`, type: 'button',
                className: `wb-cal-cell${date.getMonth() !== month ? ' out' : ''}${key === today ? ' today' : ''}${key === (selected ?? currentDate) ? ' selected' : ''}`,
                onClick: () => commit(key),
              }, date.getDate())
            })),
          withTime ? h('div', { className: 'wb-row', style: { marginTop: 8, justifyContent: 'center' } },
            h('span', { className: 'wb-small wb-muted' }, '时间'),
            h('select', { className: 'wb-select', style: { width: 72 }, value: hour, onChange: (event) => { setHour(event.target.value); if (selected) onChange(`${selected} ${event.target.value}:${minute}`) } },
              Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map((hh) => h('option', { key: hh, value: hh }, hh))),
            h('span', { className: 'wb-small wb-muted' }, ':'),
            h('select', { className: 'wb-select', style: { width: 72 }, value: minute, onChange: (event) => { setMinute(event.target.value); if (selected) onChange(`${selected} ${hour}:${event.target.value}`) } },
              Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map((mm) => h('option', { key: mm, value: mm }, mm))),
          ) : null,
          h('div', { className: 'wb-cal-foot' },
            h('button', { className: 'wb-btn ghost', onClick: () => { onChange(''); setOpen(false) } }, '清空'),
            h('button', { className: 'wb-btn ghost', onClick: () => commit(today) }, '今天'),
            withTime ? h('button', { className: 'wb-btn primary', onClick: () => setOpen(false) }, '完成') : null,
          ),
        ) : null,
      )
    }

    function Modal({ title, onClose, children, footer, wide, size, layer, className }) {
      const sizeClass = size ? ` size-${size}` : (wide ? ' wide' : '')
      return h('div', { className: `wb-modal${layer ? ' l2' : ''}`, onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: `wb-modal-card${sizeClass}${className ? ` ${className}` : ''}`, role: 'dialog', 'aria-modal': 'true' },
          h('div', { className: 'wb-modal-head' },
            h('div', { className: 'wb-card-title' }, title),
            h('div', { className: 'wb-spacer' }),
            h('button', { className: 'wb-icon-btn', 'aria-label': '关闭', title: '关闭', onClick: onClose }, '×'),
          ),
          children,
          footer ? h('div', { className: 'wb-row end' }, footer) : null,
        ))
    }

    function IconButton({ label, onClick, children, title }) {
      return h('button', { className: 'wb-icon-btn', 'aria-label': label, title: title || label, onClick }, children)
    }

    function AiTag({ model }) {
      return h('span', {
        className: 'wb-ai-tag',
        title: model ? `由 ${model} 生成，请检查后再使用` : '由 AI 生成，请检查后再使用',
      }, '✦ AI 生成')
    }

    function AiSteps({ steps, step = 0 }) {
      return h('div', { className: 'wb-ai-steps' }, steps.map((label, index) => h(React.Fragment, { key: label },
        h('span', { className: `wb-ai-step${index < step ? ' ok' : index === step ? ' on' : ''}` },
          index < step ? '✓' : index === step ? h(Spinner) : '○', label),
        index < steps.length - 1 ? h('span', { style: { color: 'var(--wb-border-strong)' } }, '→') : null,
      )))
    }

    function AiOffHint({ ai, manualText = '可以先用下面的手动方式，已经写的内容不会丢。' }) {
      if (!aiOffOf(ai)) return null
      return h('div', { className: 'wb-warnbox ai', role: 'status' },
        h('span', null, '✦'),
        h('span', { style: { flex: 1 } }, `AI 暂时不可用：${aiReasonOf(ai)}。${manualText}`))
    }

    function EmptyState({ title, text, action }) {
      return h('div', { className: 'wb-empty-state' },
        h('b', null, title),
        text ? h('div', { className: 'wb-small' }, text) : null,
        action || null,
      )
    }

    function Skeleton({ rows = 3 }) {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        Array.from({ length: rows }, (_, index) => h('div', { key: index, className: 'wb-skeleton', style: { width: `${90 - index * 12}%` } })))
    }

    function Drawer({ title, onClose, children, footer }) {
      return h('div', null,
        h('div', { className: 'wb-drawer-ov', onClick: onClose }),
        h('aside', { className: 'wb-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h('div', { className: 'wb-drawer-head' },
            h('div', { className: 'wb-card-title' }, title),
            h('div', { className: 'wb-spacer' }),
            h('button', { className: 'wb-icon-btn', 'aria-label': '关闭', onClick: onClose }, '×')),
          children,
          footer ? h('div', { className: 'wb-row end' }, footer) : null,
        ))
    }

    function ConfirmModal({ title = '确认删除', message, confirmText = '删除', onCancel, onConfirm, busy }) {
      return h(Modal, { title, onClose: onCancel },
        h('div', { className: 'wb-small' }, message),
        h('div', { className: 'wb-row end' },
          h('button', { className: 'wb-btn', onClick: onCancel }, '取消'),
          h('button', { className: 'wb-btn danger', disabled: busy, onClick: onConfirm, style: { color: '#dc2626', borderColor: 'rgba(220,38,38,.4)' } }, busy ? '处理中…' : confirmText),
        ))
    }

    function GoalFormModal({ goal, goals, parentId, cycle, cycleChoices, initialTitle, onClose, onSaved, show, ai }) {
      const RANK = CYCLE_RANK
      const derivedCycle = goal?.cycle ?? cycle ?? '周'
      const [form, setForm] = useState({
        title: goal?.title ?? initialTitle ?? '',
        detail: goal?.detail ?? '',
        cycle: derivedCycle,
        startDate: goal?.startDate ?? '',
        endDate: goal?.endDate ?? '',
        measure: goal?.measure ?? '',
        parentId: goal?.parentId ?? parentId ?? '',
      })
      const [busy, setBusy] = useState(false)
      const [errors, setErrors] = useState({})
      const [importOpen, setImportOpen] = useState(false)
      const [importText, setImportText] = useState('')
      const [preview, setPreview] = useState([])
      const [importBusy, setImportBusy] = useState('')
      const fileRef = useRef(null)
      const [extraGoals, setExtraGoals] = useState([])
      const [creatingParent, setCreatingParent] = useState(false)
      const off = aiOffOf(ai)
      const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
      const choices = cycleChoices?.length ? cycleChoices : CYCLES
      // 新建上级目标后先并入本地列表，保证下拉里立刻能显示并选中。
      const allGoals = useMemo(() => {
        const known = new Set((goals ?? []).map((item) => item.id))
        return [...(goals ?? []), ...extraGoals.filter((item) => item?.id && !known.has(item.id))]
      }, [goals, extraGoals])
      const parentOptions = allGoals.filter((item) => {
        if (goal && item.id === goal.id) return false
        return (RANK[item.cycle] ?? 0) > (RANK[form.cycle] ?? 0)
      })
      const changeCycle = (value) => {
        setForm((current) => {
          const parent = allGoals.find((item) => item.id === current.parentId)
          const keep = parent && (RANK[parent.cycle] ?? 0) > (RANK[value] ?? 0)
          return { ...current, cycle: value, parentId: keep ? current.parentId : '' }
        })
      }
      const parseImport = async (files) => {
        if (off) { show(`AI 暂时不可用：${aiReasonOf(ai)}`, 'error'); return }
        setImportBusy('parse')
        try {
          const payload = { text: importText.trim() }
          if (files?.length) {
            payload.files = []
            for (const file of files) {
              if (file.size > 30 * 1024 * 1024) { show(`${file.name} 超过 30MB`, 'error'); continue }
              payload.files.push({ name: file.name, dataBase64: toBase64(await file.arrayBuffer()) })
            }
          }
          if (!payload.text && !payload.files?.length) { show('先粘贴文本或选择文件', 'error'); return }
          const data = await request('/goals/import/parse', payload)
          setPreview((data.goals ?? []).map((item, index) => ({ ...item, checked: true, key: `${index}-${item.title}` })))
          show(`拆出 ${data.goals?.length ?? 0} 个目标${data.partial ? '（模型输出被截断，可能少了目标，建议重新拆解）' : ''}，可填入表单或全部导入`)
        } catch (error) { show(error.message, 'error') } finally { setImportBusy(''); if (fileRef.current) fileRef.current.value = '' }
      }
      const saveAll = async () => {
        const picked = preview.filter((item) => item.checked)
        if (!picked.length) { show('先勾选要导入的目标', 'error'); return }
        setImportBusy('save')
        try {
          // 先按树重排并重映射 parentIndex，再筛掉未勾选项，避免子目标挂到被取消勾选的上级名下。
          const payload = importTreeOrder(preview, (i) => Boolean(preview[i].checked))
          const data = await request('/goals/import/save', { goals: payload.map(({ key, checked, ...rest }) => rest) })
          await onSaved?.()
          show(`已导入 ${data.created.length} 个目标`)
          onClose()
        } catch (error) { show(error.message, 'error') } finally { setImportBusy('') }
      }
      const fill = (item) => {
        setForm((current) => ({
          ...current,
          title: item.title,
          detail: item.detail ?? '',
          cycle: item.cycle,
          startDate: item.startDate,
          endDate: item.endDate,
          measure: item.measure,
        }))
        setImportOpen(false)
      }
      const save = async () => {
        if (busy) return
        const nextErrors = {}
        if (!String(form.title ?? '').trim()) nextErrors.title = '请填写目标标题'
        if (!String(form.measure ?? '').trim()) nextErrors.measure = '请填写衡量方式，例如「完成 3 份标准文档」'
        if (Object.keys(nextErrors).length) {
          setErrors(nextErrors)
          setTimeout(() => { const key = Object.keys(nextErrors)[0]; document.getElementById(`goal-${key}`)?.focus() }, 0)
          return
        }
        setErrors({})
        setBusy(true)
        try {
          let created = null
          if (goal) {
            await request('/goals/update', { id: goal.id, patch: { ...form, parentId: form.parentId || null } })
            show('目标已更新')
          } else {
            const data = await request('/goals', { ...form, parentId: form.parentId || null })
            created = data?.goal ?? null
            show('目标已创建')
          }
          await onSaved?.(created)
          onClose()
        } catch (error) { show(error.message, 'error') } finally { setBusy(false) }
      }
      return h(React.Fragment, null,
        h(Modal, {
          title: goal ? '编辑目标' : '新建目标',
          onClose,
          footer: [
            h('button', { key: 'cancel', className: 'wb-btn', onClick: onClose }, '取消'),
            h('button', { key: 'save', className: 'wb-btn primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
          ],
        },
        h('div', { className: 'wb-form-grid' },
          h('label', { className: 'wb-form-field full' }, '目标标题',
            h('input', { id: 'goal-title', className: `wb-input${errors.title ? ' invalid' : ''}`, value: form.title, autoFocus: true, placeholder: '例如：完成登录改造', onChange: (event) => { set('title', event.target.value); if (errors.title) setErrors((current) => ({ ...current, title: '' })) } }),
            errors.title ? h('div', { className: 'wb-field-error' }, errors.title) : null,
            h('div', { className: 'wb-hint' }, '建议 20 字以内写结果；背景、具体范围、做法和交付物写到下面的「详细说明」。')),
          h('label', { className: 'wb-form-field full' }, '详细说明',
            h('textarea', { id: 'goal-detail', className: 'wb-textarea', rows: 3, value: form.detail ?? '', placeholder: '这项工作的具体内容、背景或交付物（可留空）', onChange: (event) => set('detail', event.target.value) })),
          h('label', { className: 'wb-form-field' }, '周期',
            h('select', { className: 'wb-select', value: form.cycle, onChange: (event) => changeCycle(event.target.value) },
              choices.map((item) => h('option', { key: item, value: item }, item)))),
          h('label', { className: 'wb-form-field' }, '上级目标',
            h('select', {
              className: 'wb-select', value: form.parentId, disabled: form.cycle === '年',
              onChange: (event) => {
                if (event.target.value === '__create__') { setCreatingParent(true); return }
                set('parentId', event.target.value)
              },
            },
              h('option', { value: '' }, form.cycle === '年' ? '年度目标没有上级' : '无（顶层）'),
              parentOptions.map((item) => h('option', { key: item.id, value: item.id }, `${item.cycle} · ${item.title}`)),
              form.cycle === '年' ? null : h('option', { value: '__create__' }, '＋ 新建上级目标'))),
          h('label', { className: 'wb-form-field' }, '开始日期',
            h(DateField, { value: form.startDate, onChange: (next) => set('startDate', next) })),
          h('label', { className: 'wb-form-field' }, '结束日期',
            h(DateField, { value: form.endDate, onChange: (next) => set('endDate', next) })),
          h('label', { className: 'wb-form-field full' }, '衡量方式',
            h('input', { id: 'goal-measure', className: `wb-input${errors.measure ? ' invalid' : ''}`, value: form.measure, placeholder: '例如：完成 3 份标准文档', onChange: (event) => { set('measure', event.target.value); if (errors.measure) setErrors((current) => ({ ...current, measure: '' })) } }),
            errors.measure ? h('div', { className: 'wb-field-error' }, errors.measure) : null),
        ),
        h('div', { className: 'wb-sep' }),
        !importOpen
          ? h('div', { className: 'wb-ai-panel', style: { flexDirection: 'row', alignItems: 'center', gap: 12 } },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('b', { style: { fontSize: 12 } }, '有现成的计划？'),
              h('div', { className: 'wb-hint' }, '贴一段文字或上传文件，AI 拆成目标，可以只填入表单，也可以全部导入。')),
            h('button', {
              className: 'wb-btn sm ai', title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : '文字 / 文件 AI 拆解',
              onClick: () => setImportOpen(true),
            }, h(SparkIcon), '文字 / 文件 AI 拆解'))
          : h('div', { className: 'wb-ai-panel' },
            h('div', { className: 'wb-row' },
              h('b', { style: { flex: 1, fontSize: 12, color: 'var(--wb-ai)', display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(SparkIcon), ' 文字 / 文件 AI 拆解'),
              h('button', { className: 'wb-btn sm ghost', onClick: () => setImportOpen(false) }, '收起')),
            h('textarea', { className: 'wb-textarea', rows: 4, placeholder: '粘贴目标内容，或选择 .md/.docx/.xlsx/.pptx 文件', value: importText, onChange: (event) => setImportText(event.target.value) }),
            off ? h(AiOffHint, { ai, manualText: '可以先手动填写下面的表单。' }) : null,
            h('div', { className: 'wb-row' },
              h('button', {
                className: 'wb-btn sm ai', disabled: importBusy === 'parse' || off,
                title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : 'AI 拆解目标',
                onClick: () => parseImport(null),
              }, importBusy === 'parse' ? h(React.Fragment, null, h(Spinner), '拆解中…') : h(React.Fragment, null, h(SparkIcon), 'AI 拆解目标')),
              preview.length ? h('button', { className: 'wb-btn sm primary', disabled: importBusy === 'save', onClick: saveAll }, importBusy === 'save' ? '导入中…' : `全部导入（${preview.filter((item) => item.checked).length}）`) : null),
            preview.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflow: 'auto' } },
              h('div', { className: 'wb-row' }, h(AiTag, { model: ai?.model }), h('span', { className: 'wb-hint' }, '可以改标题、周期和衡量方式，取消勾选不导入。')),
              preview.map((item, index) => h('div', { key: item.key, className: 'wb-ai-item', style: { alignItems: 'flex-start', flexWrap: 'wrap' } },
                h('button', {
                  type: 'button', className: `wb-check sel${item.checked ? ' on' : ''}`, role: 'checkbox',
                  'aria-checked': item.checked, 'aria-label': '选择这个目标', style: { marginTop: 5 },
                  onClick: () => setPreview(preview.map((entry, i) => i === index ? { ...entry, checked: !entry.checked } : entry)),
                }),
                h('div', { style: { flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
                  h('div', { className: 'wb-row' },
                    h('select', {
                      className: 'wb-select', style: { width: 64 }, value: item.cycle,
                      onChange: (event) => {
                        const cycle = event.target.value
                        setPreview(preview.map((entry, i) => i === index ? { ...entry, cycle, ...cycleRangeOf(cycle, entry.startDate) } : entry))
                      },
                    },
                      CYCLES.map((cycle) => h('option', { key: cycle, value: cycle }, cycle))),
                    h('input', { className: 'wb-input', value: item.title, onChange: (event) => setPreview(preview.map((entry, i) => i === index ? { ...entry, title: event.target.value } : entry)) })),
                  h('input', { className: 'wb-input', value: item.measure ?? '', placeholder: '衡量方式', onChange: (event) => setPreview(preview.map((entry, i) => i === index ? { ...entry, measure: event.target.value } : entry)) }),
                  h('textarea', { className: 'wb-textarea', rows: 2, value: item.detail ?? '', placeholder: '详细说明（具体内容 / 背景 / 交付物，可留空）', onChange: (event) => setPreview(preview.map((entry, i) => i === index ? { ...entry, detail: event.target.value } : entry)) })),
                h('button', { className: 'wb-btn sm', onClick: () => fill(item) }, '填入表单'),
                h('button', { className: 'wb-icon-btn', title: '删除', style: { color: 'var(--wb-danger)' }, onClick: () => setPreview(preview.filter((_, i) => i !== index)) }, h(TrashIcon)),
              ))) : null,
            h('div', { className: 'wb-row', style: { marginTop: 2 } },
              h('button', { className: 'wb-btn sm', onClick: () => fileRef.current?.click() }, '选择文件'),
              h('input', { ref: fileRef, type: 'file', multiple: true, style: { display: 'none' }, accept: '.md,.markdown,.txt,.docx,.doc,.xlsx,.xls,.pptx,.ppt', onChange: (event) => parseImport(event.target.files) }),
              h('span', { className: 'wb-small wb-muted' }, '支持 md / docx / xlsx / pptx')),
          ),
        ),
        creatingParent ? h(GoalFormModal, {
          goals: allGoals,
          cycle: PARENT_CYCLE[form.cycle] ?? '年',
          cycleChoices: CYCLES.filter((item) => (RANK[item] ?? 0) > (RANK[form.cycle] ?? 0)),
          ai, show,
          onClose: () => setCreatingParent(false),
          onSaved: async (created) => {
            if (!created?.id) return
            setExtraGoals((current) => (current.some((item) => item.id === created.id) ? current : [...current, created]))
            setForm((current) => ({ ...current, parentId: created.id }))
          },
        }) : null,
      )
    }

    function TodoFormModal({ todo, date, onClose, onSaved, show, ai, initialAiOpen = false }) {
      const [goals, setGoals] = useState([])
      const [goalModal, setGoalModal] = useState(false)
      const [goalQuery, setGoalQuery] = useState('')
      const [goalOpen, setGoalOpen] = useState(false)
      const [comboPos, setComboPos] = useState(null)
      const [errors, setErrors] = useState({})
      const [form, setForm] = useState({
        content: todo?.content ?? '',
        description: todo?.description ?? '',
        dueDate: todo?.dueDate ?? todo?.date ?? date,
        goalId: todo?.goalId ?? '',
      })
      const [busy, setBusy] = useState(false)
      const [aiOpen, setAiOpen] = useState(Boolean(initialAiOpen))
      const [aiText, setAiText] = useState('')
      const [aiItems, setAiItems] = useState([])
      const [aiBusy, setAiBusy] = useState('')
      const aiOff = aiOffOf(ai)
      const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
      const loadGoals = useCallback(async () => {
        try { const data = await request('/goals'); setGoals(data.goals ?? []) } catch { /* 忽略 */ }
      }, [])
      useEffect(() => { void loadGoals() }, [loadGoals])
      const selectedGoal = goals.find((goal) => goal.id === form.goalId)
      const filteredGoals = (goalQuery.trim()
        ? goals.filter((goal) => fuzzyMatch(goalQuery, `${goal.title} ${goal.cycle}`))
        : goals).slice(0, 30)
      const save = async () => {
        if (!form.content.trim()) {
          setErrors({ content: '请填写待办内容' })
          setTimeout(() => document.getElementById('todo-content')?.focus(), 0)
          return
        }
        setErrors({})
        setBusy(true)
        try {
          if (todo) {
            await request('/todos/update', {
              id: todo.id,
              content: form.content,
              description: form.description,
              goalId: form.goalId || null,
              dueDate: form.dueDate || null,
            })
            show('待办已更新')
            await onSaved?.()
          } else {
            const created = await request('/todos/add', {
              date: form.dueDate || date,
              texts: [form.content],
              dueDate: form.dueDate || date,
            })
            const item = created.created?.[0]
            if (item && (form.description || form.goalId)) {
              await request('/todos/update', { id: item.id, description: form.description, goalId: form.goalId || null })
            }
            show('待办已添加')
            await onSaved?.(item)
          }
          onClose()
        } catch (error) { show(error.message, 'error') } finally { setBusy(false) }
      }
      const aiSplit = async () => {
        if (aiOff) { show(`AI 暂时不可用：${aiReasonOf(ai)}`, 'error'); return }
        if (!aiText.trim()) { show('先输入一段话', 'error'); return }
        setAiBusy('split')
        try {
          const today = todayKey()
          const result = await request('/todos/ai-split', { text: aiText, date: today })
          const entries = Array.isArray(result.entries) && result.entries.length
            ? result.entries
            : (result.items ?? []).map((content) => ({ content, date: today }))
          setAiItems(entries.map((entry, index) => ({
            key: `${index}-${entry.content}`, content: entry.content,
            date: entry.date || today, checked: true,
          })))
          show(`AI 拆出 ${entries.length} 条，确认后添加`)
        } catch (error) { show(error.message, 'error') } finally { setAiBusy('') }
      }
      const addAiItems = async () => {
        const picked = aiItems.filter((item) => item.checked)
        if (!picked.length) { show('先勾选要添加的待办', 'error'); return }
        setAiBusy('add')
        try {
          const createdIds = []
          for (const item of picked) {
            const result = await request('/todos/add', {
              date: item.date, texts: [item.content], dueDate: item.date, startDate: item.date,
              source: 'AI 助手', aiModel: ai?.model,
            })
            for (const created of result.created ?? []) createdIds.push(created.id)
          }
          await onSaved?.()
          const count = picked.length
          show(`已添加 ${count} 条 AI 生成的待办`, 'ok', async () => {
            try {
              for (const id of createdIds) await request('/todos/delete', { id })
              await onSaved?.()
              show('已撤销添加')
            } catch (error) { show(error.message, 'error') }
          })
          onClose()
        } catch (error) { show(error.message, 'error') } finally { setAiBusy('') }
      }
      const aiPanel = !todo ? (!aiOpen
        ? h('div', { className: 'wb-ai-panel', style: { flexDirection: 'row', alignItems: 'center', gap: 12 } },
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('b', { style: { fontSize: 12 } }, '要做的事比较多？'),
            h('div', { className: 'wb-hint' }, '写一段话，AI 拆成多条待办，确认后添加。')),
          h('button', {
            className: 'wb-btn sm ai', title: aiOff ? `AI 暂时不可用：${aiReasonOf(ai)}` : '一段话 AI 拆解成待办',
            onClick: () => setAiOpen(true),
          }, h(SparkIcon), '一段话 AI 拆解成待办'))
        : h('div', { className: 'wb-ai-panel' },
          h('div', { className: 'wb-row' },
            h('b', { style: { flex: 1, fontSize: 12, color: 'var(--wb-ai)', display: 'inline-flex', alignItems: 'center', gap: 5 } }, h(SparkIcon), ' 一段话 AI 拆解成待办'),
            h('button', { className: 'wb-btn sm ghost', onClick: () => setAiOpen(false) }, '收起')),
          h('textarea', {
            className: 'wb-textarea', rows: 3, value: aiText,
            placeholder: '例如：明天先把登录灰度放到 60%，然后补完回归用例，最后找张三确认上线时间',
            onChange: (event) => setAiText(event.target.value),
          }),
          aiOff ? h(AiOffHint, { ai, manualText: '你写的内容已保留，可以展开下面「逐条填写」继续。' }) : null,
          h('div', { className: 'wb-row' },
            h('button', {
              className: 'wb-btn sm ai', disabled: aiBusy === 'split' || aiOff,
              title: aiOff ? `AI 暂时不可用：${aiReasonOf(ai)}` : 'AI 拆解',
              onClick: aiSplit,
            }, aiBusy === 'split' ? h(React.Fragment, null, h(Spinner), '拆解中…') : h(React.Fragment, null, h(SparkIcon), aiItems.length ? '重新拆解' : 'AI 拆解')),
            aiItems.length ? h('span', { className: 'wb-small wb-muted' }, `已拆出 ${aiItems.length} 条，可改内容和日期`) : null),
          aiItems.length ? h(React.Fragment, null,
            h('div', { className: 'wb-row' }, h(AiTag, { model: ai?.model }), h('span', { className: 'wb-hint' }, '确认后才会写入')),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
              aiItems.map((item, index) => h('div', { key: item.key, className: 'wb-ai-item' },
                h('button', {
                  type: 'button', className: `wb-check sel${item.checked ? ' on' : ''}`, role: 'checkbox',
                  'aria-checked': item.checked, 'aria-label': '选择这一条',
                  onClick: () => setAiItems(aiItems.map((entry, i) => i === index ? { ...entry, checked: !entry.checked } : entry)),
                }),
                h('input', {
                  className: 'wb-input', value: item.content, 'aria-label': '待办内容',
                  onChange: (event) => setAiItems(aiItems.map((entry, i) => i === index ? { ...entry, content: event.target.value } : entry)),
                }),
                h(DateField, {
                  chip: true, value: item.date,
                  onChange: (next) => setAiItems(aiItems.map((entry, i) => i === index ? { ...entry, date: next } : entry)),
                }),
              ))),
            h('div', { className: 'wb-row end' },
              h('button', { className: 'wb-btn sm ghost', onClick: () => setAiItems([]) }, '清空'),
              h('button', {
                className: 'wb-btn sm ai', disabled: aiBusy === 'add' || !aiItems.some((item) => item.checked), onClick: addAiItems,
              }, aiBusy === 'add' ? '添加中…' : `添加选中（${aiItems.filter((item) => item.checked).length}）`)),
          ) : null,
        )) : null
      return h(React.Fragment, null,
        h(Modal, {
          title: todo ? '编辑待办' : '新增待办',
          onClose,
          footer: [
            h('button', { key: 'cancel', className: 'wb-btn', onClick: onClose }, '取消'),
            h('button', { key: 'save', className: 'wb-btn primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
          ],
        },
          aiPanel,
          todo ? null : h('div', { className: 'wb-divider-label' }, '或者逐条填写'),
          h('div', { className: 'wb-form-grid' },
            h('label', { className: 'wb-form-field full' }, '内容 *',
              h('input', { id: 'todo-content', className: `wb-input${errors.content ? ' invalid' : ''}`, value: form.content, placeholder: '要做什么', onChange: (event) => { set('content', event.target.value); if (errors.content) setErrors({}) } }),
              errors.content ? h('div', { className: 'wb-field-error' }, errors.content) : null),
            h('label', { className: 'wb-form-field full' }, '描述（可选）',
              h('textarea', { className: 'wb-textarea', rows: 3, value: form.description, placeholder: '补充背景、验收标准等', onChange: (event) => set('description', event.target.value) })),
            h('label', { className: 'wb-form-field' }, '截止日期',
              h(DateField, { value: form.dueDate, onChange: (next) => set('dueDate', next), withTime: true, placeholder: '选择日期和时间' })),
            h('div', { className: 'wb-form-field' }, '关联目标',
              h('div', { className: 'wb-combo' },
                h('input', {
                  className: 'wb-input', value: goalOpen ? goalQuery : (selectedGoal ? `${selectedGoal.cycle} · ${selectedGoal.title}` : ''),
                  placeholder: '搜索或选择目标',
                  onFocus: (event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setComboPos({ left: rect.left, top: rect.bottom + 4, width: rect.width })
                    setGoalOpen(true); setGoalQuery('')
                  },
                  onChange: (event) => { setGoalOpen(true); setGoalQuery(event.target.value) },
                  onBlur: () => setTimeout(() => setGoalOpen(false), 150),
                }),
                goalOpen ? h('div', { className: 'wb-combo-list', style: comboPos ? { position: 'fixed', left: comboPos.left, top: comboPos.top, width: comboPos.width, right: 'auto' } : null },
                  h('button', { className: 'wb-combo-item', onMouseDown: (event) => event.preventDefault(), onClick: () => { set('goalId', ''); setGoalQuery(''); setGoalOpen(false) } }, '不关联'),
                  filteredGoals.map((goal) => h('button', {
                    key: goal.id, className: 'wb-combo-item',
                    onMouseDown: (event) => event.preventDefault(),
                    onClick: () => { set('goalId', goal.id); setGoalQuery(''); setGoalOpen(false) },
                  },
                    h('span', { className: `wb-cycle-badge ${goal.cycle}` }, goal.cycle),
                    h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, goal.title),
                  )),
                  filteredGoals.length ? null : h('div', { className: 'wb-empty' }, '没有匹配的目标'),
                  h('button', {
                    className: 'wb-combo-item', style: { borderTop: '1px solid var(--wb-border)', marginTop: 2, color: 'var(--wb-accent)' },
                    onMouseDown: (event) => event.preventDefault(),
                    onClick: () => { setGoalOpen(false); setGoalModal(true) },
                  }, '＋ 新增目标'),
                ) : null,
              )),
          ),
        ),
        goalModal ? h(GoalFormModal, {
          goals, ai,
          onClose: () => setGoalModal(false),
          onSaved: async (created) => { await loadGoals(); if (created?.id) set('goalId', created.id) },
          show,
        }) : null,
      )
    }

    function GoalTagEditor({ date, tags, onClose, onSaved, show, ai }) {
      const [goals, setGoals] = useState([])
      const [selected, setSelected] = useState(new Set((tags ?? []).map((tag) => tag.id)))
      const [query, setQuery] = useState('')
      const [busy, setBusy] = useState(false)
      const [creating, setCreating] = useState(false)
      const loadGoals = useCallback(async () => {
        const data = await request('/goals')
        setGoals(data.goals ?? [])
      }, [])
      useEffect(() => { loadGoals().catch((error) => show(error.message, 'error')) }, [loadGoals, show])
      const toggle = (id) => {
        const next = new Set(selected)
        if (next.has(id)) next.delete(id); else next.add(id)
        setSelected(next)
      }
      const visibleGoals = goals.filter((goal) => fuzzyMatch(query, `${goal.title} ${goal.cycle} ${goal.measure ?? ''}`))
      const save = async () => {
        setBusy(true)
        try {
          await request('/report/tags', { date, goalIds: [...selected] })
          await loadGoals()
          await onSaved?.()
          show('关联目标已更新')
          onClose()
        } catch (error) { show(error.message, 'error') } finally { setBusy(false) }
      }
      return h(React.Fragment, null,
        h(Modal, {
          title: '日报关联目标',
          onClose,
          footer: [
            h('button', { key: 'cancel', className: 'wb-btn', onClick: onClose }, '取消'),
            h('button', { key: 'save', className: 'wb-btn primary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
          ],
        },
          h('div', { className: 'wb-row' },
            h('input', { className: 'wb-input', style: { flex: 1 }, placeholder: '搜索目标（支持模糊）', value: query, onChange: (event) => setQuery(event.target.value) }),
            goals.length ? h('button', { type: 'button', className: 'wb-btn sm', onClick: () => setCreating(true) }, '＋ 新建目标') : null),
          goals.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50vh', overflow: 'auto' } },
              visibleGoals.length
                ? visibleGoals.map((goal) => h('label', { key: goal.id, className: 'wb-row', style: { cursor: 'pointer', padding: '4px 2px' } },
                  h('input', { type: 'checkbox', checked: selected.has(goal.id), onChange: () => toggle(goal.id) }),
                  h('span', { className: `wb-cycle-badge ${goal.cycle}` }, goal.cycle),
                  h('span', null, goal.title),
                ))
                : h('div', { className: 'wb-empty' }, '没有匹配的目标'))
            : h('div', { className: 'wb-empty', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 } },
              h('span', null, '还没有目标，可以直接在这里新建。'),
              h('button', { type: 'button', className: 'wb-btn sm', onClick: () => setCreating(true) }, '＋ 新建目标')),
          h('div', { className: 'wb-small wb-muted' }, `已选 ${selected.size} 个`),
        ),
        creating ? h(GoalFormModal, {
          goals, ai, show,
          onClose: () => setCreating(false),
          onSaved: async (created) => {
            if (!created?.id) return
            await loadGoals()
            setQuery('')
            setSelected((current) => new Set(current).add(created.id))
          },
        }) : null,
      )
    }

    function TodoDetailModal({ todo, goalTitle, onClose, onEdit, onDelete }) {
      const [confirming, setConfirming] = useState(false)
      const rows = [
        ['内容', todo.content],
        ['描述', todo.description || '—'],
        ['状态', todo.status],
        ['起始日期', todo.startDate || todo.date],
        ['截止日期', todo.dueDate || todo.date],
        ['关联目标', goalTitle || '未关联'],
        ['来源', todo.source || '—'],
        ['创建时间', formatLocalStamp(todo.createdAt)],
        ['更新时间', formatLocalStamp(todo.updatedAt)],
      ]
      return h(Drawer, { title: '待办详情', onClose },
        h('div', { className: 'wb-row' },
          todo.source === 'AI 助手' ? h(AiTag, { model: todo.aiModel }) : null,
          h('span', { className: 'wb-small', style: { color: 'var(--wb-text-3)' } }, todo.status)),
        h('div', { className: 'wb-kv' }, rows.map(([key, value]) => h(React.Fragment, { key }, h('div', null, key), h('div', null, String(value))))),
        confirming
          ? h('div', { className: 'wb-card', style: { borderColor: 'var(--wb-danger)' } },
            h('div', { className: 'wb-small' }, `确定删除「${todo.content}」？删除后 6 秒内可以在提示条里撤销。`),
            h('div', { className: 'wb-row end' },
              h('button', { className: 'wb-btn sm', onClick: () => setConfirming(false) }, '取消'),
              h('button', { className: 'wb-btn danger-solid sm', onClick: () => onDelete(todo) }, '确认删除')))
          : null,
        h('div', { className: 'wb-row end' },
          h('button', { className: 'wb-btn sm', onClick: onClose }, '关闭'),
          h('button', { className: 'wb-btn sm', onClick: () => onEdit(todo) }, '编辑'),
          h('button', { className: 'wb-btn danger sm', onClick: () => setConfirming(true) }, '删除'),
        ),
      )
    }

    function TodoRow({ todo, goalTitle, onEdit, onDelete, onOpen, onPostpone, onClose, selecting, selected, onToggleSelect, overdue, flash }) {
      const time = /[ T](\d{2}:\d{2})/.exec(String(todo.dueDate ?? ''))?.[1] ?? ''
      const source = String(todo.source ?? '')
      const sourceLabel = source.startsWith('日报:') ? '来自日报' : source
      return h('div', {
        className: `wb-todo${todo.status === '完成' ? ' done' : ''}${selected ? ' selected' : ''}${flash ? ' flash' : ''}`,
        id: `todo-${todo.id}`,
        'data-todo-id': todo.id,
      },
        selecting
          ? h('button', {
            type: 'button', className: `wb-check sel${selected ? ' on' : ''}`, role: 'checkbox',
            'aria-checked': Boolean(selected), 'aria-label': `选择：${todo.content}`,
            onClick: () => onToggleSelect(todo),
          })
          : h('input', {
            className: 'wb-check', type: 'checkbox', checked: todo.status === '完成',
            'aria-label': `标记完成：${todo.content}`,
            onChange: (event) => onEdit(todo, { status: event.target.checked ? '完成' : '未做' }),
          }),
        h('div', {
          className: 'wb-todo-text', style: { cursor: 'pointer' },
          title: selecting ? '点击选择' : '点击查看详情',
          onClick: () => (selecting ? onToggleSelect(todo) : onOpen?.(todo)),
        },
          h('div', { className: 'wb-todo-title' }, todo.content),
          todo.description ? h('div', { className: 'wb-small wb-muted', style: { marginTop: 2 } }, todo.description) : null,
          h('div', { className: 'wb-meta' },
            h('span', null, `${friendlyDate(todo.date)}${time ? ` ${time}` : ''}`),
            source ? h(React.Fragment, null, h('span', { style: { margin: '0 5px', opacity: .5 } }, '·'), source === 'AI 助手' ? h(AiTag, { model: todo.aiModel }) : h('span', null, sourceLabel)) : null,
            goalTitle ? h('span', { className: 'wb-todo-goal' }, goalTitle) : null,
          )),
        overdue
          ? h('div', { className: 'wb-overdue-acts' },
            h('button', { className: 'wb-btn sm', onClick: () => onPostpone?.(todo) }, '顺延'),
            h('button', { className: 'wb-btn sm ghost', onClick: () => onClose?.(todo) }, '关闭'))
          : selecting ? null : h('div', { className: 'wb-todo-acts' },
            h('button', { className: 'wb-icon-btn', title: '编辑', 'aria-label': '编辑', onClick: () => onEdit(todo, null) }, h(EditIcon)),
            h('button', { className: 'wb-icon-btn', title: '删除', 'aria-label': '删除', onClick: () => onDelete(todo), style: { color: 'var(--wb-danger)' } }, h(TrashIcon))),
      )
    }

    function Suggestions({ items, onApply, onDismiss }) {
      if (!items?.length) return null
      return h('div', { className: 'wb-card', style: { borderColor: 'var(--wb-ai-line)', background: 'var(--wb-ai-soft)' } },
        h('div', { className: 'wb-card-head' },
          h('div', { className: 'wb-card-title', style: { display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--wb-ai)' } },
            h(SparkIcon), ' AI 进度建议'),
          h(AiTag, null),
          h('span', { className: 'wb-badge' }, `${items.length} 条待确认`),
        ),
        items.map((item) => h('div', { key: item.id, className: 'wb-suggest-item' },
          h('div', { className: 'wb-row' },
            h('strong', { style: { fontSize: 12 } }, item.goalTitle),
            h('span', { className: 'wb-badge' }, `${item.from}% → ${item.to}%`),
          ),
          h('div', { className: 'wb-hint' }, `依据：${item.reason}`),
          item.quote ? h('div', { className: 'wb-quote' }, item.quote) : null,
          h('div', { className: 'wb-row end' },
            h('button', { className: 'wb-btn sm ghost', onClick: () => onDismiss(item) }, '忽略'),
            h('button', { className: 'wb-btn sm ai', onClick: () => onApply(item) }, h(SparkIcon), `采纳 ${item.to}%`),
          ),
        )),
      )
    }

    function TodoGantt({ todos }) {
      const list = todos.filter((todo) => todo.date)
      const [offsetDays, setOffsetDays] = useState(0)
      const dragRef = useRef(null)
      if (!list.length) return h('div', { className: 'wb-empty' }, '还没有待办。')
      const parse = (value) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
        return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() : NaN
      }
      const day = 86_400_000
      const starts = list.map((todo) => parse(todo.startDate ?? todo.date)).filter(Number.isFinite)
      const ends = list.map((todo) => parse(todo.dueDate ?? todo.date)).filter(Number.isFinite)
      const baseMin = Math.min(...starts)
      const todayMid = dateOfKey(todayKey())?.getTime() ?? Date.now()
      const baseMax = Math.max(...ends, todayMid + day)
      const pad = Math.max(day, (baseMax - baseMin) * 0.05)
      const min = baseMin - pad + offsetDays * day
      const max = baseMax + pad + offsetDays * day
      const span = Math.max(1, max - min)
      const pct = (value) => Math.max(0, Math.min(100, ((value - min) / span) * 100))
      const todayPct = pct(todayMid + day / 2)
      const fmt = (value) => {
        const date = new Date(value)
        return `${date.getMonth() + 1}/${date.getDate()}`
      }
      const rows = [...list].sort((a, b) => parse(a.startDate ?? a.date) - parse(b.startDate ?? b.date))
      const startDrag = (event) => {
        const track = event.currentTarget.querySelector('.wb-gantt-track')
        const width = track?.clientWidth || 600
        dragRef.current = { x: event.clientX, base: offsetDays, width }
        const move = (moveEvent) => {
          if (!dragRef.current) return
          const dx = moveEvent.clientX - dragRef.current.x
          const deltaDays = Math.round((dx / dragRef.current.width) * (span / day))
          setOffsetDays(dragRef.current.base + deltaDays)
        }
        const up = () => {
          dragRef.current = null
          document.removeEventListener('mousemove', move)
          document.removeEventListener('mouseup', up)
        }
        document.addEventListener('mousemove', move)
        document.addEventListener('mouseup', up)
      }
      return h('div', { className: 'wb-gantt' },
        h('div', { className: 'wb-row', style: { marginBottom: 2 } },
          h('span', { className: 'wb-small wb-muted' }, `${rows.length} 项 · 拖动时间轴可平移`),
          h('div', { className: 'wb-spacer' }),
          h('button', { className: 'wb-btn sm ghost', onClick: () => setOffsetDays(0), disabled: offsetDays === 0 }, '回到今天')),
        h('div', { className: 'wb-gantt-head' },
          h('span', null, `${rows.length} 项 · 拖动可平移`),
          h('div', { className: 'wb-gantt-axis' },
            h('span', null, fmt(min)),
            h('span', null, fmt((min + max) / 2)),
            h('span', null, fmt(max)),
          ),
        ),
        h('div', { style: { position: 'relative', cursor: 'grab', userSelect: 'none' }, onMouseDown: startDrag },
          rows.slice(0, 80).map((todo) => {
            const left = pct(parse(todo.startDate ?? todo.date))
            const right = pct(parse(todo.dueDate ?? todo.date) + day)
            const overdue = todo.status !== '完成' && String(todo.dueDate ?? todo.date).slice(0, 10) < todayKey()
            const color = todo.status === '完成' ? '#10b981' : overdue ? '#ef4444' : '#3B82F6'
            return h('div', { key: todo.id, className: 'wb-gantt-row', title: `${todo.content}｜${todo.startDate ?? todo.date} ~ ${todo.dueDate ?? todo.date}` },
              h('div', { className: 'wb-gantt-label' },
                h('i', { className: 'wb-gantt-dot', style: { background: color } }),
                h('span', null, todo.content)),
              h('div', { className: 'wb-gantt-track' },
                h('div', { className: 'wb-gantt-grid' }),
                h('div', {
                  className: 'wb-gantt-bar',
                  style: { left: `${left}%`, width: `${Math.max(1.5, right - left)}%`, background: `linear-gradient(180deg, ${color}, ${color}cc)` },
                }, h('span', { style: { fontSize: 9, opacity: .9 } }, fmt(parse(todo.dueDate ?? todo.date)))),
              ),
            )
          }),
          h('div', { style: { position: 'absolute', top: 0, bottom: 0, left: 202, right: 0, pointerEvents: 'none' } },
            h('div', { style: { position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, borderLeft: '1px dashed rgba(239,68,68,.6)' } }),
            h('span', { style: { position: 'absolute', top: 0, left: `calc(${todayPct}% - 11px)`, fontSize: 9, color: '#ef4444', background: 'var(--wb-card)', padding: '0 3px', borderRadius: 3 } }, '今天'),
          ),
        ),
      )
    }

    function TodoBoard({ state, refresh, show, ai }) {
      const [goals, setGoals] = useState([])
      const [editing, setEditing] = useState(null)
      const [detail, setDetail] = useState(null)
      const [creating, setCreating] = useState(false)
      const [createAi, setCreateAi] = useState(false)
      const [collapsed, setCollapsed] = useState({})
      const [selecting, setSelecting] = useState(false)
      const [selected, setSelected] = useState(new Set())
      const [batchConfirm, setBatchConfirm] = useState(false)
      const [batchBusy, setBatchBusy] = useState(false)
      const [view, setView] = useState('list')
      const [quickText, setQuickText] = useState('')
      const [quickBusy, setQuickBusy] = useState(false)
      const [flashId, setFlashId] = useState('')
      const date = state.date
      const today = todayKey()

      const loadGoals = useCallback(async () => {
        try { const data = await request('/goals'); setGoals(data.goals ?? []) } catch { /* 忽略 */ }
      }, [])
      useEffect(() => { void loadGoals() }, [loadGoals])
      useEffect(() => {
        if (!flashId) return undefined
        const node = document.getElementById(`todo-${flashId}`)
        node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        const timer = setTimeout(() => setFlashId(''), 1600)
        return () => clearTimeout(timer)
      }, [flashId])

      const goalTitle = (id) => goals.find((goal) => goal.id === id)?.title
      const openTodo = (todo) => setDetail(todo)
      const setStatus = async (todo, patch) => {
        if (patch?.status) {
          try { await request('/todos/status', { id: todo.id, status: patch.status }); await refresh() }
          catch (error) { show(error.message, 'error') }
          return
        }
        setEditing(todo)
      }
      const restoreTodo = async (todo) => {
        await request('/todos/add', { restore: todo })
        await refresh()
        show('已撤销删除')
      }
      const removeTodo = async (todo) => {
        try {
          const data = await request('/todos/delete', { id: todo.id })
          const removed = data.removed ?? todo
          setDetail(null)
          await refresh()
          show(`已删除「${String(todo.content).slice(0, 16)}」，6 秒内可撤销`, 'ok', async () => {
            try { await restoreTodo(removed) } catch (error) { show(error.message, 'error') }
          })
        } catch (error) { show(error.message, 'error') }
      }
      const postpone = async (todo) => {
        try { await request('/todos/postpone', { ids: [todo.id], date: today }); await refresh(); show('已顺延到今天') }
        catch (error) { show(error.message, 'error') }
      }
      const closeTodo = async (todo) => {
        try { await request('/todos/status', { id: todo.id, status: '完成' }); await refresh(); show('已关闭这条待办') }
        catch (error) { show(error.message, 'error') }
      }
      const quickAdd = async () => {
        const text = quickText.trim()
        if (!text || quickBusy) return
        setQuickBusy(true)
        try {
          const data = await request('/todos/add', { date: today, texts: [text], dueDate: today })
          const item = data.created?.[0]
          setQuickText('')
          await refresh()
          if (item?.id) setFlashId(item.id)
          show('已添加待办')
        } catch (error) { show(error.message, 'error') } finally { setQuickBusy(false) }
      }

      const seen = new Set()
      const all = [...(state.todos ?? []), ...(state.upcoming ?? [])].filter((todo) => {
        if (seen.has(todo.id)) return false
        seen.add(todo.id)
        return true
      })
      const overdue = all.filter((todo) => todo.status !== '完成' && todo.date < today).sort((a, b) => (a.date < b.date ? -1 : 1))
      const todays = all.filter((todo) => todo.date === today)
      const openToday = todays.filter((todo) => todo.status !== '完成')
      const doneToday = todays.filter((todo) => todo.status === '完成')
      const leverIds = new Set((state.levers?.items ?? []).map((item) => item.todoId))
      const leverTodos = all.filter((todo) => leverIds.has(todo.id))
      const chores = [...overdue, ...openToday].filter((todo) => !leverIds.has(todo.id))
      const choresOverdue = chores.filter((todo) => todo.date < today)
      const choresToday = chores.filter((todo) => todo.date === today)
      const doneTodayOther = doneToday.filter((todo) => !leverIds.has(todo.id))
      const openAll = all.filter((todo) => todo.status !== '完成').length
      const upcoming = all.filter((todo) => todo.status !== '完成' && todo.date > today).sort((a, b) => (a.date < b.date ? -1 : 1))
      const byDate = new Map()
      for (const todo of upcoming) {
        const list = byDate.get(todo.date) ?? []
        list.push(todo)
        byDate.set(todo.date, list)
      }
      const toggleSelect = (item) => setSelected((current) => {
        const next = new Set(current)
        if (next.has(item.id)) next.delete(item.id); else next.add(item.id)
        return next
      })
      const exitBatch = () => { setSelecting(false); setSelected(new Set()) }
      const renderGroup = (key, title, list, { overdue: isOverdue = false, defaultCollapsed = false } = {}) => {
        const isCollapsed = collapsed[key] ?? (key === 'done' || defaultCollapsed)
        return h('div', { className: 'wb-todo-group', id: key === 'over' ? 'wb-overdue-group' : undefined },
          h('button', {
            type: 'button', className: 'wb-group-title clickable',
            'aria-expanded': !isCollapsed,
            onClick: () => setCollapsed((current) => ({ ...current, [key]: !current[key] })),
          },
            h('span', null, `${isCollapsed ? '▸' : '▾'} ${title}`),
            h('i', null, list.length),
          ),
          isCollapsed ? null : list.length
            ? list.map((todo) => h(TodoRow, {
              key: todo.id, todo, goalTitle: goalTitle(todo.goalId), overdue: isOverdue,
              onEdit: setStatus, onDelete: removeTodo, onOpen: openTodo,
              onPostpone: postpone, onClose: closeTodo,
              selecting, selected: selected.has(todo.id), onToggleSelect: toggleSelect,
              flash: flashId === todo.id,
            }))
            : h('div', { className: 'wb-group-empty' }, '暂无'),
        )
      }
      const batchItems = all.filter((todo) => selected.has(todo.id))
      const batchDone = async () => {
        const targets = batchItems.filter((todo) => todo.status !== '完成')
        if (!targets.length) return
        try {
          for (const todo of targets) await request('/todos/status', { id: todo.id, status: '完成' })
          await refresh()
          show(`已标记 ${targets.length} 项完成`, 'ok', async () => {
            try {
              for (const todo of targets) await request('/todos/status', { id: todo.id, status: '未做' })
              await refresh(); show('已撤销')
            } catch (error) { show(error.message, 'error') }
          })
          exitBatch()
        } catch (error) { show(error.message, 'error') }
      }
      const doBatchDelete = async () => {
        if (!batchItems.length) return
        setBatchBusy(true)
        try {
          await request('/todos/delete-batch', { ids: batchItems.map((todo) => todo.id) })
          setBatchConfirm(false)
          exitBatch()
          await refresh()
          show(`已删除 ${batchItems.length} 条待办`, 'ok', async () => {
            try {
              for (const todo of batchItems) await request('/todos/add', { restore: todo })
              await refresh(); show('已撤销删除')
            } catch (error) { show(error.message, 'error') }
          })
        } catch (error) { show(error.message, 'error') } finally { setBatchBusy(false) }
      }

      const openCreate = (withAi = false) => { setCreateAi(withAi); setCreating(true) }
      const batchbar = selecting ? h('div', { className: 'wb-batchbar', role: 'toolbar', 'aria-label': '批量操作' },
        h('span', { className: 'wb-small' }, `已选 ${selected.size} 项`),
        h('div', { className: 'wb-spacer' }),
        h('button', {
          className: 'wb-btn sm ghost',
          onClick: () => setSelected(selected.size === all.length ? new Set() : new Set(all.map((todo) => todo.id))),
        }, selected.size === all.length && all.length ? '取消全选' : '全选'),
        h('button', { className: 'wb-btn sm', disabled: !selected.size, onClick: batchDone }, '标记完成'),
        h('button', { className: 'wb-btn sm danger-solid', disabled: !selected.size, onClick: () => setBatchConfirm(true) }, `删除选中（${selected.size}）`),
        h('button', { className: 'wb-btn sm ghost', onClick: exitBatch }, '取消'),
      ) : null

      return h('div', { className: 'wb-card wb-todo-card', style: { minHeight: 0 } },
        h('div', { className: 'wb-card-head' },
          h('div', { className: 'wb-card-title' }, '待办事项'),
          h('span', { className: 'wb-badge' }, `还剩 ${openAll} 项 · 共 ${all.length} 项`),
          h('div', { className: 'wb-seg', role: 'group', 'aria-label': '视图' },
            h('button', { className: view === 'list' ? 'on' : '', onClick: () => setView('list') }, '列表'),
            h('button', { className: view === 'gantt' ? 'on' : '', onClick: () => setView('gantt') }, '甘特')),
          h('div', { className: 'wb-spacer' }),
          h('button', { className: 'wb-btn sm ghost', onClick: () => (selecting ? exitBatch() : setSelecting(true)) }, selecting ? '退出批量' : '批量删除'),
          h('button', {
            className: 'wb-icon-btn', title: '刷新', 'aria-label': '刷新',
            onClick: async () => { await refresh(); await loadGoals() },
          }, h(RefreshIcon)),
          h('button', { className: 'wb-btn sm primary', onClick: () => openCreate(false) }, '＋ 新增待办'),
        ),
        h('div', { className: 'wb-todo-body' },
          h('div', { className: 'wb-sep' }),
          view === 'gantt'
            ? h(TodoGantt, { todos: all })
            : h(React.Fragment, null,
              !all.length
                ? h(EmptyState, {
                  title: '今天还没有待办',
                  text: '用一段话告诉 AI 你今天要做什么，它会拆成待办；也可以手动添加。',
                  action: h('div', { className: 'wb-row', style: { justifyContent: 'center' } },
                    h('button', {
                      className: 'wb-btn ai sm', disabled: aiOffOf(ai), title: aiOffOf(ai) ? `AI 暂时不可用：${aiReasonOf(ai)}` : '让 AI 拆解',
                      onClick: () => openCreate(true),
                    }, h(SparkIcon), '用一段话让 AI 拆解'),
                    h('button', { className: 'wb-btn sm', onClick: () => openCreate(false) }, '手动新增')),
                })
                : h(React.Fragment, null,
                  !selecting && view === 'list' ? h('form', {
                    className: 'wb-quick',
                    onSubmit: (event) => { event.preventDefault(); void quickAdd() },
                  },
                    h('input', {
                      className: 'wb-input', placeholder: '快速添加：输入后回车，默认今天', value: quickText,
                      'aria-label': '快速添加待办', onChange: (event) => setQuickText(event.target.value),
                    }),
                    h('button', { className: 'wb-btn sm', type: 'submit', disabled: quickBusy || !quickText.trim() }, quickBusy ? '添加中…' : '添加'),
                  ) : null,
                  leverIds.size
                    ? h(React.Fragment, null,
                      leverTodos.length ? renderGroup('levers', '⚡ 今日杠杆', leverTodos) : null,
                      chores.length
                        ? renderGroup('chores', `杂务 ${chores.length} 项（此前未完成 ${choresOverdue.length} / 今日 ${choresToday.length}）`, chores, { defaultCollapsed: true })
                        : null)
                    : h(React.Fragment, null,
                      renderGroup('over', '此前未完成', overdue, { overdue: true }),
                      renderGroup('today', '今日待办', openToday)),
                  [...byDate.keys()].sort().map((key) => renderGroup(`d:${key}`, `之后 · ${friendlyDate(key)}`, byDate.get(key))),
                  doneTodayOther.length ? renderGroup('done', '已完成', doneTodayOther) : null,
                ),
            ),
          batchbar,
        ),
        creating ? h(TodoFormModal, {
          date, ai, initialAiOpen: createAi,
          onClose: () => { setCreating(false); setCreateAi(false) },
          onSaved: async (created) => {
            await refresh(); await loadGoals()
            if (created?.id) setFlashId(created.id)
          },
          show,
        }) : null,
        editing ? h(TodoFormModal, {
          todo: editing, date, ai, onClose: () => setEditing(null),
          onSaved: async () => { await refresh(); await loadGoals() }, show,
        }) : null,
        batchConfirm ? h(ConfirmModal, {
          title: '批量删除待办', message: `确定删除选中的 ${selected.size} 条待办？删除后 6 秒内仍可撤销。`, busy: batchBusy,
          onCancel: () => setBatchConfirm(false),
          onConfirm: doBatchDelete,
        }) : null,
        detail ? h(TodoDetailModal, {
          todo: detail, goalTitle: goalTitle(detail.goalId),
          onClose: () => setDetail(null),
          onEdit: (item) => { setDetail(null); setEditing(item) },
          onDelete: (item) => { setDetail(null); void removeTodo(item) },
        }) : null,
      )
    }

    function formatClock(date, settings, tz) {
      const twelve = settings?.clockFormat === '12'
      if (tz) {
        try {
          return new Intl.DateTimeFormat('zh-CN', {
            timeZone: tz, hour12: twelve, hour: '2-digit', minute: '2-digit',
            ...(settings?.clockSeconds ? { second: '2-digit' } : {}),
          }).format(date)
        } catch { /* 退回本地时间 */ }
      }
      let hours = date.getHours()
      let suffix = ''
      if (twelve) {
        suffix = hours < 12 ? '上午 ' : '下午 '
        hours = hours % 12 || 12
      }
      const hh = String(hours).padStart(2, '0')
      const mm = String(date.getMinutes()).padStart(2, '0')
      const ss = settings?.clockSeconds ? `:${String(date.getSeconds()).padStart(2, '0')}` : ''
      return `${suffix}${hh}:${mm}${ss}`
    }

    function DailyBanner({ settings, show, timezone }) {
      const [quote, setQuote] = useState(null)
      const [weather, setWeather] = useState(null)
      const [now, setNow] = useState(() => new Date())
      const seconds = settings?.clockSeconds === true
      useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), seconds ? 1000 : 30_000)
        return () => clearInterval(timer)
      }, [seconds])
      useEffect(() => {
        request('/quote/today').then((data) => setQuote(data.quote)).catch(() => {})
        const tz = timezone || currentTz()
        request(`/weather${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`).then((data) => setWeather(data.weather)).catch(() => {})
      }, [settings?.region, settings?.weatherEnabled, timezone])
      const dateText = formatDateInZone(now, timezone || currentTz())
      const [mealOpen, setMealOpen] = useState(false)
      const [fortuneOpen, setFortuneOpen] = useState(false)
      const mealBtnRef = useRef(null)
      const fortuneBtnRef = useRef(null)
      const closeMeal = () => {
        setMealOpen(false)
        requestAnimationFrame(() => mealBtnRef.current?.focus())
      }
      const closeFortune = () => {
        setFortuneOpen(false)
        requestAnimationFrame(() => fortuneBtnRef.current?.focus())
      }
      return h(React.Fragment, null,
        h('div', { className: 'wb-banner' },
          h('div', { className: 'wb-banner-facts' },
            weather?.ok ? h('span', { className: 'wb-banner-item' }, `☁ ${weather.city ? `${weather.city} ` : ''}${weather.text}`) : null,
            h('span', { className: 'wb-banner-item time' }, formatClock(now, settings, timezone || currentTz())),
            h('span', { className: 'wb-banner-item' }, dateText),
          ),
          quote ? h('div', { className: 'wb-banner-quote' },
            `“${quote.text}”`,
            h('small', null, `— ${quote.author}${quote.source ? `《${quote.source}》` : ''}`),
          ) : null,
          h('div', { className: 'wb-lucky-actions' },
            h('button', {
              ref: mealBtnRef, className: 'wb-btn sm', onClick: () => setMealOpen(true),
            }, '🍚 今天吃什么'),
            h('button', {
              ref: fortuneBtnRef, className: 'wb-btn sm', onClick: () => setFortuneOpen(true),
            }, '🎋 今日运势')),
        ),
        mealOpen ? h(LuckyMealModal, { show, onClose: closeMeal }) : null,
        fortuneOpen ? h(LuckyFortuneModal, { show, onClose: closeFortune }) : null,
      )
    }


    // ===== 今日页：今天吃什么 / 今日运势（feature-c） =====
    const luckyMemory = new Map()
    function luckyGet(key) {
      try {
        const value = window.localStorage?.getItem(key)
        if (value !== null && value !== undefined) return value
      } catch { /* localStorage 不可用时退回内存 */ }
      return luckyMemory.get(key) ?? null
    }
    function luckySet(key, value) {
      luckyMemory.set(key, value)
      try { window.localStorage?.setItem(key, value) } catch { /* localStorage 不可用时只留内存 */ }
    }
    function luckyReduceMotion() {
      try { return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true } catch { return false }
    }
    function luckyPad2(value) { return String(value).padStart(2, '0') }
    function luckyNowHM() {
      const now = nowInZone()
      return `${luckyPad2(now.getHours())}:${luckyPad2(now.getMinutes())}`
    }
    function luckyMealKey(hm) {
      const [hour, minute] = String(hm).split(':').map(Number)
      const value = hour + minute / 60
      if (value >= 5 && value < 10) return 'breakfast'
      if (value >= 10 && value < 14) return 'lunch'
      if (value >= 14 && value < 17) return 'tea'
      if (value >= 17 && value < 21) return 'dinner'
      return 'night'
    }
    function luckyHash(text) {
      let hash = 2166136261
      for (const char of String(text)) {
        hash ^= char.charCodeAt(0)
        hash = Math.imul(hash, 16777619)
      }
      return hash >>> 0
    }
    function luckyStars(value) {
      return h(React.Fragment, null,
        h('span', null, '★'.repeat(value)),
        h('span', { style: { opacity: .25 } }, '★'.repeat(5 - value)))
    }
    function luckyTubeSvg({ shaking, stickUp }) {
      return h('svg', {
        className: `wb-lucky-tube${shaking ? ' shake' : ''}`,
        width: 120, height: 170, viewBox: '0 0 120 170', 'aria-hidden': true,
      },
        h('g', { className: `wb-lucky-stick${stickUp ? ' up' : ''}` },
          h('rect', { x: 50, y: 22, width: 9, height: 86, rx: 3, fill: '#D9A441' }),
          h('rect', { x: 50, y: 22, width: 9, height: 16, rx: 3, fill: '#C0392B' })),
        h('rect', { x: 62, y: 30, width: 7, height: 78, rx: 3, fill: '#E6B85C' }),
        h('rect', { x: 38, y: 34, width: 7, height: 74, rx: 3, fill: '#CFA03F' }),
        h('path', { d: 'M26 70 H94 V150 Q94 162 82 162 H38 Q26 162 26 150 Z', fill: '#B8742F' }),
        h('path', { d: 'M26 70 H94 V84 H26Z', fill: '#9C5F22' }),
        h('rect', { x: 40, y: 96, width: 40, height: 36, rx: 6, fill: '#F7E2B5' }),
        h('text', { x: 60, y: 122, textAnchor: 'middle', fontSize: 22, fontFamily: 'Songti SC,serif', fill: '#9C2A1E' }, '签'))
    }

    function LuckyMealModal({ show, onClose }) {
      const [meal] = useState(() => luckyMealKey(luckyNowHM()))
      const [nowText] = useState(() => luckyNowHM())
      const [filter, setFilter] = useState('')
      const [phase, setPhase] = useState('idle')
      const [result, setResult] = useState(null)
      const [strip, setStrip] = useState([])
      const [sparks, setSparks] = useState([])
      const [lastName, setLastName] = useState(null)
      const stripRef = useRef(null)
      const actionRef = useRef(null)
      const okRef = useRef(null)
      const timersRef = useRef([])
      const mealData = LUCKY_DATA.meals[meal]
      const items = mealData.items
      const filtered = filter ? items.filter((item) => item.k.includes(filter)) : items
      const pool = filtered.length >= 2 ? filtered : items
      const busy = phase === 'rolling'
      const clearTimers = () => {
        for (const id of timersRef.current) clearTimeout(id)
        timersRef.current = []
      }
      const later = (fn, ms) => {
        const id = setTimeout(fn, ms)
        timersRef.current.push(id)
        return id
      }
      const close = () => {
        clearTimers()
        onClose?.()
      }
      const land = (final) => {
        setPhase('done')
        setResult(final)
        if (!luckyReduceMotion()) {
          const colors = ['#F59E0B', '#2563EB', '#10B981', '#EC4899', '#8B5CF6']
          setSparks(Array.from({ length: 14 }, (_, index) => {
            const angle = (index / 14) * Math.PI * 2
            const radius = 60 + Math.random() * 50
            return { key: index, color: colors[index % colors.length], x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius * .6) }
          }))
          later(() => setSparks([]), 900)
        }
        later(() => okRef.current?.focus(), 0)
      }
      const roll = () => {
        if (phase === 'rolling') return
        let final
        do {
          final = pool[Math.floor(Math.random() * pool.length)]
        } while (pool.length > 1 && lastName && final.n === lastName)
        setLastName(final.n)
        setResult(null)
        setSparks([])
        setPhase('rolling')
        const current = stripRef.current
        if (current) {
          current.style.transition = 'none'
          current.style.transform = 'translateY(0)'
        }
        const sequence = []
        let previous = null
        const count = luckyReduceMotion() ? 1 : 22
        const avoidPrevious = pool.length > 2
        for (let index = 0; index < count; index += 1) {
          let pick
          do {
            pick = pool[Math.floor(Math.random() * pool.length)]
          } while (pick.n === final.n || (avoidPrevious && pick === previous))
          sequence.push(pick)
          previous = pick
        }
        const all = [{ n: '', e: '' }, ...sequence, { ...final, final: true }, { n: '', e: '' }]
        setStrip(all)
        later(() => {
          const element = stripRef.current
          if (!element) return
          const finalIndex = all.length - 2
          const offset = -(finalIndex - 1) * 50
          element.style.transition = 'none'
          element.style.transform = 'translateY(0)'
          void element.offsetHeight
          const duration = luckyReduceMotion() ? 0 : 2600
          if (duration) element.style.transition = `transform ${duration}ms cubic-bezier(.12,.72,.14,1)`
          element.style.transform = `translateY(${offset}px)`
          later(() => land(final), duration + 60)
        }, 40)
      }
      const changeFilter = (value) => {
        if (busy) return
        setFilter(value)
        setResult(null)
        setSparks([])
        setPhase('idle')
        setStrip([])
      }
      const takeIt = () => {
        const name = result?.n
        close()
        if (name) show?.(`决定了：${name}，吃得开心～`)
      }
      useEffect(() => { actionRef.current?.focus() }, [])
      useEffect(() => () => clearTimers(), [])
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); close(); return }
          if ((event.key === ' ' || event.key === 'Enter') && phase !== 'rolling') {
            const tag = document.activeElement?.tagName ?? ''
            if (!/^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(tag)) { event.preventDefault(); roll() }
          }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      })
      return h(Modal, {
        title: h(React.Fragment, null, `${mealData.label}吃什么 `, h('span', { className: 'wb-lucky-sub' }, `${mealData.range} · 现在 ${nowText}`)),
        onClose: close, size: 'sm',
      },
        h('div', { className: 'wb-lucky-content' },
          h('div', { className: 'wb-lucky-chips' }, h('span', null, '口味'),
            [['', '不限'], ['l', '清淡'], ['h', '重口'], ['q', '快手']].map(([value, label]) => h('button', {
              key: value || 'all', type: 'button', disabled: busy,
              className: `wb-chip${filter === value ? ' on' : ''}`,
              'aria-pressed': filter === value,
              onClick: () => changeFilter(value),
            }, label))),
          h('div', { className: 'wb-lucky-reel', 'aria-hidden': true },
            h('div', { className: `wb-lucky-band${phase === 'done' ? ' hit' : ''}` }),
            strip.length ? h('div', { className: 'wb-lucky-strip', ref: stripRef },
              strip.map((item, index) => h('div', {
                key: `${index}-${item.n}-${item.final ? 'f' : ''}`,
                className: `wb-lucky-item${item.final ? ' final' : ''}${item.final && phase === 'done' ? ' hit' : ''}`,
              }, h('span', { className: 'em' }, item.e || ''), h('span', null, item.n || '')))) : null,
            phase === 'idle' && !result ? h('div', { className: 'wb-lucky-cover' },
              h('b', null, items[0]?.e ?? '🍚'), h('span', null, '点下面的按钮，让命运替你决定')) : null,
            sparks.length ? h('div', { className: 'wb-lucky-spark' }, sparks.map((spark) => h('i', {
              key: spark.key,
              style: { '--c': spark.color, '--x': `${spark.x}px`, '--y': `${spark.y}px` },
            }))) : null),
          h('div', { className: 'wb-lucky-tip', 'aria-live': 'polite', role: 'status' },
            result ? h(React.Fragment, null, h('b', null, `${result.e} ${result.n}`), result.t) : ''),
          h('div', { className: 'wb-row', style: { gap: 8, justifyContent: 'center' } },
            h('button', {
              ref: actionRef, className: 'wb-btn primary', disabled: busy, onClick: roll, style: { minWidth: 120 },
            }, busy ? '抽取中…' : phase === 'done' ? '再抽一次' : '开抽'),
            phase === 'done' ? h('button', { ref: okRef, className: 'wb-btn', onClick: takeIt }, '就吃这个') : null),
          h('div', { className: 'wb-lucky-foot' }, '本地随机，不需要 AI；AI 不可用时也能用')))
    }

    function LuckyFortuneModal({ show, onClose }) {
      const [day] = useState(() => todayKey())
      const [tab, setTab] = useState('sign')
      const [busy, setBusy] = useState(false)
      const [signShaking, setSignShaking] = useState(false)
      const [stickUp, setStickUp] = useState(false)
      const [signDrawn, setSignDrawn] = useState(() => Boolean(luckyGet(`wb.lucky.fortune.${day}`)))
      const [signJustDrawn, setSignJustDrawn] = useState(false)
      const [tarotDrawn, setTarotDrawn] = useState(() => Boolean(luckyGet(`wb.lucky.tarot.${day}`)))
      const [tarotRevealed, setTarotRevealed] = useState(false)
      const [pickedBack, setPickedBack] = useState(null)
      const [signName, setSignName] = useState(() => luckyGet('wb.lucky.sign'))
      const timersRef = useRef([])
      const primaryRef = useRef(null)
      const middleBackRef = useRef(null)
      const clearTimers = () => {
        for (const id of timersRef.current) clearTimeout(id)
        timersRef.current = []
      }
      const later = (fn, ms) => {
        const id = setTimeout(fn, ms)
        timersRef.current.push(id)
        return id
      }
      const close = () => {
        clearTimers()
        onClose?.()
      }
      const fortune = LUCKY_DATA.fortunes[luckyHash(day) % LUCKY_DATA.fortunes.length]
      const tarot = LUCKY_DATA.tarot[luckyHash(`tarot${day}`) % LUCKY_DATA.tarot.length]
      const sign = signName ? (LUCKY_DATA.signs.find((item) => item.n === signName) ?? null) : null
      const horo = (() => {
        if (!sign) return null
        const hash = luckyHash(day + sign.n)
        const score = (shift) => 3 + ((hash >>> shift) % 3)
        return {
          summary: LUCKY_DATA.horo.sum[hash % LUCKY_DATA.horo.sum.length],
          work: LUCKY_DATA.horo.work[(hash >>> 3) % LUCKY_DATA.horo.work.length],
          mood: LUCKY_DATA.horo.mood[(hash >>> 6) % LUCKY_DATA.horo.mood.length],
          overall: score(2), workStars: score(5), moodStars: score(8),
          color: LUCKY_DATA.fortunes[(hash >>> 2) % LUCKY_DATA.fortunes.length].c,
          number: 1 + ((hash >>> 4) % 9),
        }
      })()
      const switchTab = (next) => {
        if (busy) return
        clearTimers()
        setSignShaking(false)
        setStickUp(false)
        setSignJustDrawn(false)
        setPickedBack(null)
        setTarotRevealed(false)
        setTab(next)
      }
      const shake = () => {
        if (busy || signDrawn) return
        const reduce = luckyReduceMotion()
        setBusy(true)
        setSignShaking(true)
        later(() => {
          setSignShaking(false)
          setStickUp(true)
          later(() => {
            luckySet(`wb.lucky.fortune.${day}`, '1')
            setSignDrawn(true)
            setSignJustDrawn(true)
            setStickUp(false)
            setBusy(false)
          }, reduce ? 0 : 750)
        }, reduce ? 0 : 1300)
      }
      const pickTarot = (index) => {
        if (busy || tarotDrawn) return
        const reduce = luckyReduceMotion()
        setBusy(true)
        setPickedBack(index)
        later(() => {
          luckySet(`wb.lucky.tarot.${day}`, '1')
          setTarotDrawn(true)
          setTarotRevealed(true)
          setBusy(false)
        }, reduce ? 0 : 700)
      }
      const selectSign = (name) => {
        luckySet('wb.lucky.sign', name)
        setSignName(name)
      }
      useEffect(() => {
        const id = setTimeout(() => {
          if (tab === 'tarot' && !tarotDrawn) middleBackRef.current?.focus()
          else primaryRef.current?.focus()
        }, 30)
        return () => clearTimeout(id)
      }, [tab, signDrawn, tarotDrawn])
      useEffect(() => () => clearTimers(), [])
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') { event.preventDefault(); close() }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      })
      const footer = tab === 'tarot'
        ? '每天一张 · 只展示正位 · 仅供娱乐'
        : tab === 'star' ? '每天更新 · 星星最少 3 颗 · 仅供娱乐' : '每天一次 · 个个都是好结果 · 仅供娱乐'
      const keepButton = (text, message) => h('div', { className: 'wb-row', style: { gap: 8, justifyContent: 'center' } },
        h('button', {
          ref: primaryRef, className: 'wb-btn primary',
          onClick: () => { close(); show?.(message) },
        }, text))
      const signBody = signDrawn
        ? h(React.Fragment, null,
          h('div', { className: signJustDrawn ? 'wb-lucky-fade' : '' },
            h('div', {
              className: 'wb-lucky-card', role: 'status', 'aria-live': 'polite',
              style: signJustDrawn ? undefined : { animation: 'none' },
            },
              h('span', { className: 'wb-lucky-level' }, fortune.lv),
              h('div', { className: 'wb-lucky-poem' }, fortune.p[0], h('br'), fortune.p[1]),
              h('div', { className: 'wb-lucky-sep' }),
              h('div', { className: 'wb-lucky-reading' }, fortune.t),
              h('div', { className: 'wb-lucky-yi' },
                h('span', null, '今日宜'),
                fortune.yi.map((item) => h('span', { key: item, className: 'wb-lucky-yi-tag' }, item))),
              h('div', { className: 'wb-lucky-lucky' }, `幸运色 ${fortune.c} · 幸运数字 ${fortune.n}`))),
          keepButton('收下', '已收下今天的签，明天再来～'))
        : h(React.Fragment, null,
          h('div', { className: 'wb-lucky-tubewrap' }, luckyTubeSvg({ shaking: signShaking, stickUp })),
          h('div', { className: 'wb-lucky-tip' }, '心里默念一件事，然后摇一摇'),
          h('div', { className: 'wb-row', style: { gap: 8, justifyContent: 'center' } },
            h('button', {
              ref: primaryRef, className: 'wb-btn primary', disabled: busy, onClick: shake, style: { minWidth: 120 },
            }, busy ? '摇签中…' : '摇一摇')))
      const tarotFace = h(React.Fragment, null,
        h('div', {
          className: `wb-lucky-tarot${tarotRevealed ? ' flip' : ''}`,
          role: 'status', 'aria-live': 'polite',
        },
          h('div', { className: 'wb-lucky-tcard' },
            h('div', { className: 'wb-lucky-tr' }, tarot.r),
            h('div', { className: 'wb-lucky-te' }, tarot.e),
            h('div', { className: 'wb-lucky-tn' }, tarot.n)),
          h('div', { className: 'wb-lucky-tbody' },
            h('div', { className: 'wb-lucky-tkw' }, tarot.kw.split('·').map((word, index) => h('span', { key: index, className: 'wb-lucky-tag' }, word))),
            h('div', { className: 'wb-lucky-reading' }, tarot.t),
            h('div', { className: 'wb-lucky-advice' },
              h('span', null, '今日建议'),
              h('span', { className: 'wb-lucky-tag' }, tarot.yi)))),
        keepButton('收下', '已收下今天的牌，明天再来～'))
      const tarotBody = tarotDrawn
        ? tarotFace
        : h(React.Fragment, null,
          h('div', { className: 'wb-lucky-tip', style: { minHeight: 0, marginBottom: 6 } }, '深呼吸，想着今天的自己，凭感觉挑一张牌'),
          h('div', { className: 'wb-lucky-fan' },
            [0, 1, 2, 3, 4].map((index) => h('button', {
              key: index, type: 'button', disabled: busy,
              className: `wb-lucky-back${pickedBack !== null && index !== pickedBack ? ' dim' : ''}${pickedBack === index ? ' chosen' : ''}`,
              style: { '--r': `${(index - 2) * 7}deg`, '--y': `${Math.abs(index - 2) * 4}px` },
              'aria-label': `第 ${index + 1} 张牌`,
              ref: index === 2 ? middleBackRef : undefined,
              onClick: () => pickTarot(index),
            }, h('span', null, '✦')))))
      const starBody = h(React.Fragment, null,
        h('div', { className: 'wb-lucky-signs' },
          LUCKY_DATA.signs.map((item, index) => h('button', {
            key: item.n, type: 'button',
            className: `wb-lucky-sign${signName === item.n ? ' on' : ''}`,
            'aria-pressed': signName === item.n,
            ref: signName === item.n || (!signName && index === 0) ? primaryRef : undefined,
            onClick: () => selectSign(item.n),
          },
            h('b', null, item.s), h('span', null, item.n), h('i', null, item.r)))),
        sign && horo
          ? h('div', { className: 'wb-lucky-horo wb-lucky-fade', role: 'status', 'aria-live': 'polite' },
            h('div', { className: 'wb-lucky-sh' },
              h('b', null, `${sign.s} ${sign.n}`),
              h('span', { className: 'wb-lucky-sub' }, `${sign.k} · ${day.slice(5)}`)),
            h('div', { className: 'wb-lucky-st' }, horo.summary),
            [['综合', horo.overall, ''], ['工作', horo.workStars, horo.work], ['心情', horo.moodStars, horo.mood]].map(([label, value, text]) => h('div', { key: label, className: 'wb-lucky-rate' },
              h('span', null, label),
              h('span', { className: 'wb-lucky-stars', 'aria-label': `${value} 星` }, luckyStars(value)),
              h('span', { className: 'wb-lucky-rt' }, text || ''))),
            h('div', { className: 'wb-lucky-lucky', style: { textAlign: 'center' } }, `幸运色 ${horo.color} · 幸运数字 ${horo.number}`))
          : h('div', { className: 'wb-lucky-tip' }, '选一个你的星座，看今天的运势'))
      return h(Modal, {
        title: h(React.Fragment, null, '今日运势 ', h('span', { className: 'wb-lucky-sub' }, day)),
        onClose: close, size: 'sm',
      },
        h('div', { className: 'wb-lucky-content' },
          h('div', { className: 'wb-seg', role: 'tablist', style: { alignSelf: 'center' } },
            [['sign', '抽签'], ['tarot', '塔罗'], ['star', '星座']].map(([key, label]) => h('button', {
              key, type: 'button', role: 'tab', 'aria-selected': tab === key, disabled: busy,
              className: tab === key ? 'on' : '',
              onClick: () => switchTab(key),
            }, label))),
          tab === 'sign' ? signBody : tab === 'tarot' ? tarotBody : starBody,
          h('div', { className: 'wb-lucky-foot' }, footer)))
    }
    function TodayTab({ state, refresh, show, suggestions, onApplySuggestion, onDismissSuggestion, notice, onCloseNotice, onSnoozeNotice }) {
      const [leftWidth, setLeftWidth] = useState(() => {
        const saved = Number(window.localStorage?.getItem('wb.today.leftWidth'))
        return Number.isFinite(saved) && saved >= 320 ? saved : 560
      })
      const [overdueSignal, setOverdueSignal] = useState(0)
      const [reportEditor, setReportEditor] = useState(null)
      const [narrow, setNarrow] = useState(() => (typeof window === 'undefined' ? false : window.innerWidth < 1080))
      const widthRef = useRef(leftWidth)
      useEffect(() => { widthRef.current = leftWidth }, [leftWidth])
      useEffect(() => {
        const onResize = () => setNarrow(window.innerWidth < 1080)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])
      useEffect(() => {
        if (!overdueSignal) return
        document.getElementById('wb-overdue-group')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      }, [overdueSignal])
      const startDrag = (event) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = widthRef.current
        let frame = 0
        let latest = startWidth
        document.body.classList.add('wb-dragging')
        const onMove = (moveEvent) => {
          latest = Math.max(320, Math.min(window.innerWidth - 420, startWidth + moveEvent.clientX - startX))
          if (!frame) frame = requestAnimationFrame(() => {
            frame = 0
            setLeftWidth(latest)
            try { window.localStorage?.setItem('wb.today.leftWidth', String(latest)) } catch { /* 忽略 */ }
          })
        }
        const onUp = () => {
          if (frame) cancelAnimationFrame(frame)
          document.body.classList.remove('wb-dragging')
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }
      const completedCount = (state.todos ?? []).filter((todo) => todo.date === state.today && todo.status === '完成').length
      return h(React.Fragment, null,
        notice ? h(NoticeCard, {
          notice, onClose: onCloseNotice,
          onViewOverdue: () => setOverdueSignal((value) => value + 1),
          ai: state.ai, date: state.today, completedCount, onSnooze: onSnoozeNotice,
          onOpenReport: (options) => setReportEditor({ date: state.today, ...options }),
        }) : null,
        h(DailyBanner, { settings: state.settings, show, timezone: state.timezone }),
        h(V2LeverCard, { levers: state.levers, refresh, show, ai: state.ai, animate: state.settings?.leverAnimation !== false }),
        h(Suggestions, { items: suggestions, onApply: onApplySuggestion, onDismiss: onDismissSuggestion }),
        h('div', { className: `wb-today${narrow ? ' wb-today-narrow' : ''}`, style: narrow ? undefined : { gridTemplateColumns: `${leftWidth}px 8px minmax(0,1fr)` } },
          h('div', { className: 'wb-col' }, h(TodoBoard, { state, refresh, show, ai: state.ai })),
          narrow ? null : h('div', { className: 'wb-split', title: '拖动调整宽度', onMouseDown: startDrag }),
          h('div', { className: 'wb-col' },
            h(AssistantCard, { state, refresh, show }), h(CalendarPanel, { refresh, show, state, ai: state.ai })),
        ),
        reportEditor ? h(ReportEditorModal, {
          date: reportEditor.date, onClose: () => setReportEditor(null), refresh, show, ai: state.ai,
          initialStep: reportEditor.initialStep ?? 1,
          initialSessionIds: reportEditor.initialSessionIds ?? null,
          initialExtraText: reportEditor.initialExtraText ?? '',
          initialManual: Boolean(reportEditor.initialManual),
          autoGenerate: Boolean(reportEditor.autoGenerate),
        }) : null,
      )
    }

    /** 2.0 · 北极星页（人生面） */
    function NorthStarTab({ state, show, onOpenSettings }) {
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [wizard, setWizard] = useState(false)
      const [history, setHistory] = useState(false)
      const [revealed, setRevealed] = useState(false)
      const [expanded, setExpanded] = useState(new Set())
      const blurEnabled = state?.settings?.northStar?.blur !== false
      const load = useCallback(async () => {
        try {
          const result = await request('/northstar')
          setData(result)
          setError('')
        } catch (err) { setError(err.message) } finally { setLoading(false) }
      }, [])
      useEffect(() => { void load() }, [load])
      const blurred = blurEnabled && !revealed
      const toggleEvidence = (id) => setExpanded((current) => {
        const next = new Set(current)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
      const exportMarkdown = async () => {
        try {
          const current = data?.raw ? data : await request('/northstar')
          if (!current?.raw) { show('还没有可导出的北极星', 'error'); return }
          if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm('导出北极星 Markdown？文件只会保存到你选择的位置。')) return
          downloadBlob('北极星.md', new Blob([current.raw], { type: 'text/markdown;charset=utf-8' }))
          show('已导出北极星.md')
        } catch (err) { show(err.message, 'error') }
      }

      if (loading) return h('div', { className: 'wb-card' }, h(Skeleton, { rows: 5 }))
      if (error) {
        return h(EmptyState, {
          title: '北极星没加载出来', text: error,
          action: h('button', { className: 'wb-btn primary sm', onClick: () => { setLoading(true); void load() } }, '重试'),
        })
      }
      if (!data?.exists) {
        return h(React.Fragment, null,
          h('div', { className: 'wb-card wb-northstar' },
            h('div', { className: 'wb-ns-head' },
              h('div', { className: 'wb-card-title' }, '北极星 🔒'),
              h('div', { className: 'wb-spacer' })),
            h('div', { className: 'wb-empty-state' },
              h('b', null, '以后再写也可以'),
              h('div', { className: 'wb-small' }, '用几句话写下你不想变成什么样、想往哪去、要成为什么样的人。只存本机，AI 不会代写。'),
              h('button', { className: 'wb-btn primary sm', onClick: () => setWizard(true) }, '写北极星'))),
          wizard ? h(NorthStarWizard, {
            data, onClose: () => setWizard(false),
            onSaved: async () => { await load() },
            show,
          }) : null)
      }

      return h('div', null,
        h('div', { className: 'wb-card wb-northstar' },
          h('div', { className: 'wb-ns-head' },
            h('div', { className: 'wb-card-title' }, '北极星 🔒'),
            h('span', { className: 'wb-badge' }, `v${data.version} · ${String(data.updatedAt ?? '').slice(0, 10)}`),
            h('div', { className: 'wb-spacer' }),
            blurEnabled ? h('button', { className: 'wb-btn ghost sm', onClick: () => setRevealed(!revealed) }, revealed ? '遮挡' : '显示') : null,
            h('button', { className: 'wb-btn sm', onClick: () => setWizard(true) }, '编辑'),
            h('button', { className: 'wb-btn sm ghost', onClick: () => setHistory(true) }, '历史'),
            h('button', { className: 'wb-btn sm ghost', onClick: exportMarkdown }, '导出')),
          h('div', { className: 'wb-ns-main', onClick: blurred ? () => setRevealed(true) : undefined },
            h('div', { className: blurred ? 'wb-ns-blurred' : '' },
              h('div', { className: 'wb-ns-section' },
                h('div', { className: 'wb-ns-label' }, '我拒绝让我的生活变成'),
                data.antiVision ? h('div', { className: 'wb-ns-text' }, data.antiVision) : h('div', { className: 'wb-hint' }, '（还没写）')),
              h('div', { className: 'wb-ns-section' },
                h('div', { className: 'wb-ns-label' }, '我正在奔向（一句话愿景，会变）'),
                data.vision ? h('div', { className: 'wb-ns-text' }, data.vision) : h('div', { className: 'wb-hint' }, '（还没写）')),
              h('div', { className: 'wb-ns-section' },
                h('div', { className: 'wb-ns-label' }, '我是……的人'),
                data.identity.length
                  ? data.identity.map((item) => h('div', { key: item.id, className: 'wb-ns-identity' },
                    h('div', { className: 'wb-ns-text' }, item.text),
                    h('button', {
                      className: 'wb-ns-evidence', onClick: () => toggleEvidence(item.id),
                    }, `本月证据 ${item.evidenceCount} 条 ${expanded.has(item.id) ? '▾' : '▸'}`),
                    expanded.has(item.id)
                      ? h('div', { className: 'wb-ns-evlist' },
                        item.evidence.length
                          ? item.evidence.map((entry, index) => h('div', { key: index, className: 'wb-small wb-muted' }, `${entry.date} ${entry.text}`))
                          : h('div', { className: 'wb-hint' }, '本月还没有证据'))
                      : null))
                  : h('div', { className: 'wb-hint' }, '（还没写）')),
              h('div', { className: 'wb-ns-section' },
                h('div', { className: 'wb-ns-label' }, '我的规则（不愿意牺牲的）'),
                data.rules.length ? h('div', { className: 'wb-ns-text' }, data.rules.join('；')) : h('div', { className: 'wb-hint' }, '（还没写）'))),
            blurred ? h('div', { className: 'wb-ns-veil' }, '点击显示') : null),
          h('div', { className: 'wb-ns-foot' },
            h('span', null, '只在本机 · 默认不发给模型 · 不进周报'),
            h('button', { className: 'wb-btn ghost sm', onClick: onOpenSettings }, '设置隐私开关'))),
        wizard ? h(NorthStarWizard, {
          data, onClose: () => setWizard(false),
          onSaved: async () => { await load() },
          show,
        }) : null,
        history ? h(NorthStarHistory, { onClose: () => setHistory(false), show }) : null)
    }

    /** 2.0 · 北极星四步向导（没有 AI 代写） */
    function NorthStarWizard({ data, onClose, onSaved, show }) {
      const steps = ['开始', '反愿景', '一句话愿景', '身份宣言与规则']
      const [step, setStep] = useState(0)
      const [fields, setFields] = useState({
        antiVision: data?.antiVision ?? '',
        vision: data?.vision ?? '',
        identityText: (data?.identity ?? []).map((item) => item.text).join('\n'),
        rulesText: (data?.rules ?? []).join('\n'),
      })
      const [saveChoice, setSaveChoice] = useState(false)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const set = (key, value) => { setFields((current) => ({ ...current, [key]: value })); setError('') }
      const identityList = () => fields.identityText.split('\n').map((line) => line.trim()).filter(Boolean)
      const rulesList = () => fields.rulesText.split('\n').map((line) => line.trim()).filter(Boolean)

      const saveDraft = async () => {
        setBusy('draft')
        try {
          const text = `反愿景：${fields.antiVision}\n一句话愿景：${fields.vision}\n身份宣言：\n${identityList().join('\n')}\n规则：\n${rulesList().join('\n')}`
          await request('/northstar/draft', { text })
          show('草稿已保存')
        } catch (err) { setError(err.message) } finally { setBusy('') }
      }
      const submit = async (mode) => {
        setBusy('save')
        try {
          const result = await request('/northstar/save', {
            fields: {
              antiVision: fields.antiVision,
              vision: fields.vision,
              identity: identityList(),
              rules: rulesList(),
            },
            mode,
          })
          await onSaved?.()
          show(`北极星已保存为 v${result.version}`)
          onClose()
        } catch (err) { setError(err.message); setBusy('') }
      }
      const hasContent = () => Boolean(fields.antiVision.trim() || fields.vision.trim() || identityList().length || rulesList().length)
      const next = () => {
        if (step < 3) { setStep(step + 1); return }
        if (!hasContent()) { onClose(); return }
        if (data?.exists) setSaveChoice(true)
        else void submit('minor')
      }
      const skip = () => {
        if (step === 0) { onClose(); return }
        next()
      }
      const body = step === 0
        ? h('div', null,
          h('div', { className: 'wb-ns-intro' },
            h('p', null, '北极星不是计划，是你想去的方向的几句话。它只存在本机，不会发给模型，也不会进周报。'),
            h('p', null, '四步都可以跳过，写几个字也行，以后随时可以改。这里没有「AI 帮我写」按钮：这一步只属于你。'),
            h('div', { className: 'wb-hint' }, '建议 15 分钟；写一半可以点「保存草稿」，下次继续。'),
            data?.draft ? h('div', { className: 'wb-ns-draft' },
              h('b', null, '上次草稿：'),
              h('div', { className: 'wb-small' }, String(data.draft).replace(/\s+/g, ' ').slice(0, 120))) : null))
        : step === 1
          ? h(React.Fragment, null,
            h('div', { className: 'wb-ns-question' }, '如果接下来 5 年什么都不改变，你平常的一天大概是什么样？'),
            h('div', { className: 'wb-ns-question' }, '其中哪一部分，是你最不愿意接受的？'),
            h('textarea', {
              className: 'wb-textarea', rows: 6, autoFocus: true, value: fields.antiVision,
              placeholder: '我拒绝让我的生活变成……',
              onChange: (event) => set('antiVision', event.target.value),
            }))
          : step === 2
            ? h(React.Fragment, null,
              h('div', { className: 'wb-ns-question' }, '如果 3 年后某个普通的日子让你挺满意，那天是什么样？'),
              h('div', { className: 'wb-ns-question' }, '用一句话写下你正在奔向的方向——它以后会变，先写个第一版。'),
              h('textarea', {
                className: 'wb-textarea', rows: 4, autoFocus: true, value: fields.vision,
                placeholder: '我正在奔向……',
                onChange: (event) => set('vision', event.target.value),
              }))
            : h(React.Fragment, null,
              h('div', { className: 'wb-ns-question' }, '过上那样的日子，需要你成为什么样的人？用「我是……的人」写 1–3 句。'),
              h('textarea', {
                className: 'wb-textarea', rows: 4, autoFocus: true, value: fields.identityText,
                placeholder: '我是……的人（每行一条）',
                onChange: (event) => set('identityText', event.target.value),
              }),
              h('div', { className: 'wb-ns-question', style: { marginTop: 10 } }, '为了这些，有什么是你不愿意牺牲的？'),
              h('textarea', {
                className: 'wb-textarea', rows: 3, value: fields.rulesText,
                placeholder: '不牺牲睡眠；周日陪家人（每行一条，可留空）',
                onChange: (event) => set('rulesText', event.target.value),
              }))

      return h(Modal, {
        title: `写下你的北极星 · 第 ${step + 1}/4 步`,
        size: 'md',
        onClose,
        footer: saveChoice
          ? [
            h('button', { key: 'back', className: 'wb-btn', disabled: Boolean(busy), onClick: () => setSaveChoice(false) }, '返回'),
            h('button', { key: 'minor', className: 'wb-btn', disabled: Boolean(busy), onClick: () => void submit('minor') }, '小修改（覆盖当前）'),
            h('button', { key: 'version', className: 'wb-btn primary', disabled: Boolean(busy), onClick: () => void submit('version') }, '存为新版本'),
          ]
          : [
            h('button', { key: 'prev', className: 'wb-btn', disabled: step === 0 || Boolean(busy), onClick: () => setStep(step - 1) }, '上一步'),
            h('button', { key: 'skip', className: 'wb-btn ghost', disabled: Boolean(busy), onClick: skip }, step === 0 ? '跳过向导' : '跳过这一步'),
            h('button', { key: 'draft', className: 'wb-btn ghost', disabled: Boolean(busy), onClick: () => void saveDraft() }, busy === 'draft' ? '保存中…' : '保存草稿'),
            h('button', {
              key: 'next', className: 'wb-btn primary', disabled: Boolean(busy),
              onClick: next,
            }, busy === 'save' ? '保存中…' : step === 3 ? '保存' : '下一步'),
          ],
      },
      h('div', { className: 'wb-hint', style: { marginBottom: 8 } }, `${steps[step]} · 这些内容只存在本机，默认不发给模型`),
      saveChoice ? h('div', { className: 'wb-warnbox', style: { marginBottom: 8 } }, '这次保存要覆盖当前版本，还是保留历史、升一个新版本？') : null,
      body,
      error ? h('div', { className: 'wb-field-error', style: { marginTop: 8 } }, error) : null)
    }

    /** 2.0 · 北极星历史（只读 + 简单逐行对比） */
    function NorthStarHistory({ onClose, show }) {
      const [items, setItems] = useState([])
      const [loading, setLoading] = useState(true)
      const [view, setView] = useState(null)
      const [compare, setCompare] = useState(null)
      const [busy, setBusy] = useState('')
      useEffect(() => {
        let alive = true
        request('/northstar/history')
          .then((data) => { if (alive) setItems(data.items ?? []) })
          .catch((error) => show(error.message, 'error'))
          .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
      }, [show])
      const open = async (item) => {
        setBusy(`read:${item.version}`)
        try {
          const current = await request(`/northstar/history/read?v=${item.version}`)
          setView(current)
          const previous = items.find((entry) => entry.version < item.version)
          setCompare(previous ? await request(`/northstar/history/read?v=${previous.version}`) : null)
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const lineDiff = (before, after) => {
        const beforeLines = String(before ?? '').split('\n')
        const afterLines = String(after ?? '').split('\n')
        const beforeSet = new Set(beforeLines)
        const afterSet = new Set(afterLines)
        return [
          ...afterLines.map((line) => ({ kind: beforeSet.has(line) ? 'same' : 'add', line })),
          ...beforeLines.filter((line) => !afterSet.has(line)).map((line) => ({ kind: 'del', line })),
        ]
      }
      const body = view
        ? h('div', null,
          h('div', { className: 'wb-row', style: { marginBottom: 8 } },
            h('button', { className: 'wb-btn ghost sm', onClick: () => { setView(null); setCompare(null) } }, '← 返回列表'),
            h('span', { className: 'wb-hint' }, `v${view.version} · ${view.date}`)),
          h('pre', { className: 'wb-ns-history-doc' },
            (compare ? lineDiff(compare.markdown, view.markdown) : view.markdown.split('\n').map((line) => ({ kind: 'same', line })))
              .map((entry, index) => h('span', {
                key: index,
                className: entry.kind === 'add' ? 'wb-diff-add' : entry.kind === 'del' ? 'wb-diff-del' : '',
              }, `${entry.kind === 'add' ? '+' : entry.kind === 'del' ? '-' : ' '} ${entry.line}\n`))))
        : loading
          ? h('div', { style: { padding: 8 } }, h(Skeleton, { rows: 3 }))
          : items.length
            ? h('div', { className: 'wb-ns-history-list' }, items.map((item) => h('button', {
              key: item.name, className: 'wb-ns-history-item', disabled: Boolean(busy),
              onClick: () => void open(item),
            },
            h('span', { className: 'wb-small', style: { fontWeight: 600 } }, `v${item.version}`),
            h('span', { className: 'wb-small wb-muted' }, item.date),
            h('span', { className: 'wb-spacer' }),
            h('span', { className: 'wb-small' }, '查看'))))
            : h('div', { className: 'wb-empty-state' }, h('b', null, '还没有历史版本'), h('div', { className: 'wb-small' }, '保存时选「存为新版本」会在这里保留旧版本。'))
      return h(Modal, {
        title: '北极星历史', size: 'md', onClose,
        footer: [h('button', { key: 'close', className: 'wb-btn', onClick: onClose }, '关闭')],
      }, body)
    }

    /** 2.0 · 今日杠杆卡（今日页 DailyBanner 下方） */
    function V2LeverCard({ levers, refresh, show, ai, animate }) {
      const [busy, setBusy] = useState('')
      const [adjustOpen, setAdjustOpen] = useState(false)
      const [justDone, setJustDone] = useState('')
      const off = aiOffOf(ai)
      if (!levers) return null
      const items = levers.items ?? []
      const candidates = levers.candidates ?? []
      const done = items.filter((item) => item.status === '完成').length
      const date = levers.date || todayKey()
      const run = async (label, fn) => {
        setBusy(label)
        try { await fn() } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const toggle = (item) => {
        const next = item.status === '完成' ? '未做' : '完成'
        if (next === '完成' && animate !== false) {
          setJustDone(item.todoId)
          setTimeout(() => setJustDone(''), 700)
        }
        void run(`toggle:${item.todoId}`, async () => {
          await request('/todos/status', { id: item.todoId, status: next })
          await refresh()
        })
      }
      const confirmCandidates = () => run('confirm', async () => {
        const res = await request('/levers/set', {
          date,
          items: candidates.map((item) => ({ todoId: item.todoId, goalId: item.goalId })),
        })
        await refresh()
        show(res.belowMin ? '已设 1 个杠杆；通常 2–4 个更合适' : `已设 ${res.items?.length ?? 0} 个杠杆`)
      })
      const skip = () => run('skip', async () => {
        await request('/levers/skip', { date })
        await refresh()
        show('今天不设杠杆')
      })
      const suggest = () => run('suggest', async () => {
        if (off) { show(`AI 暂时不可用：${aiReasonOf(ai)}`, 'error'); return }
        const res = await request('/levers/suggest', { date, force: true })
        await refresh()
        show(res.by === 'ai' ? `AI 推荐了 ${res.candidates?.length ?? 0} 条候选` : `本地匹配了 ${res.candidates?.length ?? 0} 条候选`)
      })

      const body = items.length
        ? h('div', { className: 'wb-lever-list' }, items.map((item) => h('div', {
          key: item.todoId,
          className: `wb-lever-row${item.status === '完成' ? ' done' : ''}${justDone === item.todoId ? ' just-done' : ''}`,
        },
        h('button', {
          type: 'button', className: `wb-check sel${item.status === '完成' ? ' on' : ''}`, role: 'checkbox',
          'aria-checked': item.status === '完成', 'aria-label': item.status === '完成' ? '标记未完成' : '标记完成',
          onClick: () => toggle(item),
        }),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { className: 'wb-lever-title' }, item.content),
          item.goalTitle ? h('div', { className: 'wb-lever-goal' }, `▸ ${item.goalTitle}`) : null))))
        : levers.candidateStatus === 'pending' && candidates.length
          ? h('div', { className: 'wb-lever-pending' },
            h('div', { className: 'wb-hint' }, `AI 推荐了 ${candidates.length} 条候选，确认后才会写进今天的目标：`),
            h('div', { className: 'wb-lever-cands' }, candidates.map((item) => h('div', { key: item.todoId, className: 'wb-lever-cand' },
              h('span', { className: 'wb-lever-cand-title' }, item.content),
              item.goalTitle ? h('span', { className: 'wb-lever-cand-goal' }, `▸ ${item.goalTitle}`) : null,
              item.reason ? h('span', { className: 'wb-lever-reason' }, item.reason) : null))),
            h('div', { className: 'wb-row' },
              h('button', { className: 'wb-btn sm primary', disabled: Boolean(busy), onClick: confirmCandidates }, busy === 'confirm' ? '设置中…' : '确认'),
              h('button', { className: 'wb-btn sm', disabled: Boolean(busy), onClick: () => setAdjustOpen(true) }, '改一改'),
              h('button', { className: 'wb-btn sm ghost', disabled: Boolean(busy), onClick: skip }, '今天不设')))
          : levers.candidateStatus === 'skipped'
            ? h('div', { className: 'wb-lever-pending' },
              h('div', { className: 'wb-hint' }, '今天不设杠杆。'),
              h('div', { className: 'wb-row' }, h('button', { className: 'wb-btn sm', onClick: () => setAdjustOpen(true) }, '改一改')))
            : h('div', { className: 'wb-lever-pending' },
              h('div', { className: 'wb-hint' }, '今天还没设杠杆。先挑 ' + LEVER_MIN + '–' + LEVER_MAX + ' 个能推动目标的待办。'),
              h('div', { className: 'wb-row' },
                h('button', {
                  className: 'wb-btn sm ai', disabled: off || Boolean(busy), title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : '让 AI 从待办里挑候选',
                  onClick: suggest,
                }, h(SparkIcon), busy === 'suggest' ? '挑选中…' : '帮我挑'),
                h('button', { className: 'wb-btn sm', disabled: Boolean(busy), onClick: () => setAdjustOpen(true) }, '手动选')))

      return h('div', { className: 'wb-card wb-lever-card' },
        h('div', { className: 'wb-lever-head' },
          h('div', { className: 'wb-lever-title-wrap' },
            h('b', null, '⚡ 今日杠杆'),
            items.length ? h('span', { className: 'wb-badge' }, `${done}/${items.length} 完成`) : null,
            items.length === 1 ? h('span', { className: 'wb-lever-single' }, '今天 1 个杠杆') : null),
          h('div', { className: 'wb-spacer' }),
          h('button', { className: 'wb-btn ghost sm', onClick: () => setAdjustOpen(true) }, items.length ? '调整' : '选择')),
        body,
        adjustOpen ? h(V2LeverModal, {
          levers, refresh, show, onClose: () => setAdjustOpen(false),
          initialSelected: items.length ? null : candidates.map((item) => item.todoId),
        }) : null)
    }

    /** 2.0 · 选择今天的杠杆（候选 + 挂目标 + 新建待办） */
    function V2LeverModal({ levers, refresh, show, onClose, initialSelected, focusTodoId }) {
      const data = levers ?? {}
      const date = data.date || todayKey()
      const goals = data.goals ?? []
      const reasons = new Map((data.candidates ?? []).map((item) => [item.todoId, item.reason]))
      const pool = useMemo(() => {
        const list = [...(data.pool ?? [])]
        if (focusTodoId) list.sort((a, b) => (a.id === focusTodoId ? -1 : b.id === focusTodoId ? 1 : 0))
        return list
      }, [data.pool, focusTodoId])
      const locked = (data.items ?? []).filter((item) => item.status === '完成')
      const lockedIds = new Set(locked.map((item) => item.todoId))
      const preselect = initialSelected ?? (data.items ?? []).filter((item) => !lockedIds.has(item.todoId)).map((item) => item.todoId)
      const [selected, setSelected] = useState(() => new Set(preselect))
      const [goalOf, setGoalOf] = useState(() => {
        const map = {}
        for (const todo of data.pool ?? []) map[todo.id] = todo.goalId ?? ''
        for (const item of data.items ?? []) map[item.todoId] = item.goalId ?? ''
        for (const item of data.candidates ?? []) if (!(item.todoId in map)) map[item.todoId] = item.goalId ?? ''
        return map
      })
      const [newText, setNewText] = useState('')
      const [adding, setAdding] = useState(false)
      const [busy, setBusy] = useState('')
      const [singleConfirm, setSingleConfirm] = useState(false)

      const toggle = (id) => {
        setSingleConfirm(false)
        if (selected.has(id)) {
          const next = new Set(selected)
          next.delete(id)
          setSelected(next)
          return
        }
        if (selected.size + locked.length >= LEVER_MAX) { show(`杠杆最多 ${LEVER_MAX} 个，先放下一个`, 'error'); return }
        setSelected(new Set(selected).add(id))
      }
      const addTodo = async () => {
        const text = newText.trim()
        if (!text || adding) return
        setAdding(true)
        try {
          const created = await request('/todos/add', { date, texts: [text], dueDate: date })
          const item = created.created?.[0]
          setNewText('')
          if (item?.id) {
            setSelected((current) => new Set(current).add(item.id))
            setGoalOf((current) => ({ ...current, [item.id]: '' }))
          }
          await refresh()
          show('已新建待办并选中')
        } catch (error) { show(error.message, 'error') } finally { setAdding(false) }
      }
      const submit = async () => {
        if (!selected.size || busy) return
        if (selected.size === 1 && !singleConfirm) { setSingleConfirm(true); return }
        setBusy('save')
        try {
          const res = await request('/levers/set', {
            date,
            items: [...selected].map((id) => ({ todoId: id, goalId: goalOf[id] || null })),
          })
          await refresh()
          show(res.belowMin ? '已设 1 个杠杆；通常 2–4 个更合适' : `已设 ${res.items?.length ?? 0} 个杠杆`)
          onClose()
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }

      const lockedRows = locked.map((item) => h('div', { key: `locked-${item.todoId}`, className: 'wb-lever-pick locked' },
        h('button', {
          type: 'button', className: 'wb-check sel on', role: 'checkbox', 'aria-checked': true,
          'aria-label': '已完成的杠杆', disabled: true,
        }),
        h('div', { style: { flex: 1, minWidth: 0 } },
          h('div', { className: 'wb-lever-title' }, item.content, h('span', { className: 'wb-lever-tag' }, '已完成')),
          item.goalTitle ? h('div', { className: 'wb-lever-goal' }, `▸ ${item.goalTitle}`) : null)))
      const rows = pool.length
        ? pool.map((todo) => h('div', { key: todo.id, className: `wb-lever-pick${selected.has(todo.id) ? ' on' : ''}` },
          h('button', {
            type: 'button', className: `wb-check sel${selected.has(todo.id) ? ' on' : ''}`, role: 'checkbox',
            'aria-checked': selected.has(todo.id), 'aria-label': '选择这个待办',
            onClick: () => toggle(todo.id),
          }),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'wb-lever-title' }, todo.content,
              todo.postponed ? h('span', { className: 'wb-lever-tag' }, `顺延 ×${todo.postponed}`) : null),
            h('div', { className: 'wb-row', style: { marginTop: 3 } },
              h('select', {
                className: 'wb-select', style: { width: 170 }, value: goalOf[todo.id] ?? '',
                onChange: (event) => setGoalOf({ ...goalOf, [todo.id]: event.target.value }),
              },
                h('option', { value: '' }, '不挂目标'),
                goals.map((goal) => h('option', { key: goal.id, value: goal.id }, `${goal.cycle} · ${goal.title}`))),
              reasons.get(todo.id) ? h('span', { className: 'wb-lever-reason' }, `AI：${reasons.get(todo.id)}`) : null))))
        : h('div', { className: 'wb-hint' }, '今天没有可选的待办，先在下面新建一条。')

      return h(Modal, {
        title: '选今天的杠杆',
        size: 'md',
        onClose,
        footer: [
          h('button', {
            key: 'cancel', className: 'wb-btn',
            onClick: () => (singleConfirm ? setSingleConfirm(false) : onClose()),
          }, singleConfirm ? '再选选' : '取消'),
          h('button', {
            key: 'ok', className: 'wb-btn primary', disabled: !selected.size || Boolean(busy), onClick: submit,
          }, busy === 'save' ? '保存中…' : singleConfirm ? '就这样' : `确认 ${selected.size} 个`),
        ],
      },
      h('div', { className: 'wb-hint', style: { marginBottom: 8 } },
        `每天 ${LEVER_MIN}–${LEVER_MAX} 个能推动目标的待办；已选 ${selected.size + locked.length} 个${locked.length ? `（其中 ${locked.length} 个已完成）` : ''}。`),
      singleConfirm ? h('div', { className: 'wb-warnbox', style: { marginBottom: 8 } },
        h('span', { style: { flex: 1 } }, '通常 2–4 个更合适，确定只设 1 个吗？')) : null,
      h('div', { className: 'wb-lever-pool' }, [...lockedRows, ...rows]),
      h('div', { className: 'wb-row', style: { marginTop: 10 } },
        h('input', {
          className: 'wb-input', placeholder: '新建一条待办并设为杠杆', value: newText,
          onChange: (event) => setNewText(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); void addTodo() } },
        }),
        h('button', { className: 'wb-btn sm', disabled: adding || !newText.trim(), onClick: () => void addTodo() }, adding ? '添加中…' : '添加')))
    }

    function markdownToHtml(markdown) {
      const esc = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      const inline = (text) => esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>')
      const lines = String(markdown ?? '').split(/\r?\n/)
      const out = []
      let list = null
      const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null } }
      for (const line of lines) {
        const heading = /^(#{1,4})\s+(.+?)\s*$/.exec(line)
        if (heading) { flush(); const level = Math.min(4, heading[1].length); out.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue }
        const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(line)
        if (bullet) { list = list ?? []; list.push(`<li>${inline(bullet[1])}</li>`); continue }
        flush()
        if (line.trim()) out.push(`<p>${inline(line)}</p>`)
      }
      flush()
      return out.join('\n')
    }

    function fillTemplate(template, { markdown, date, title, tags = [] }) {
      const esc = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const safe = template && template.includes('{{content}}') ? template : '<!doctype html><meta charset="utf-8"><body>{{content}}</body>'
      const tagsHtml = Array.isArray(tags) && tags.length
        ? `<div class="wb-tags">${tags.map((tag) => `<span>${esc(tag)}</span>`).join('')}</div>`
        : ''
      const rawContent = markdownToHtml(markdown)
      const content = safe.includes('{{tags}}') ? rawContent : `${tagsHtml}${rawContent}`
      return safe
        .split('{{content}}').join(content)
        .split('{{tags}}').join(tagsHtml)
        .split('{{title}}').join(title ?? `${date} 工作日报`)
        .split('{{date}}').join(date ?? '')
        .split('{{generatedAt}}').join(formatDateTimeInZone(new Date()))
    }

    function downloadBlob(name, blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1000)
    }

    async function copyRich(html, text) {
      try {
        if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          })])
          return true
        }
      } catch { /* 退回纯文本 */ }
      try { await navigator.clipboard.writeText(text); return true } catch { return false }
    }

    function printHtml(html) {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
      // 同源但禁止脚本：模板 HTML 里即使有 <script> 也不会在导出流程里执行。
      iframe.setAttribute('sandbox', 'allow-same-origin')
      document.body.appendChild(iframe)
      iframe.onload = () => {
        try {
          iframe.contentWindow.focus()
          iframe.contentWindow.print()
        } catch { /* 打印不可用 */ }
        setTimeout(() => iframe.remove(), 60_000)
      }
      iframe.srcdoc = html
    }

    async function exportPng(html, name) {
      const iframe = document.createElement('iframe')
      iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1200px;border:0'
      // 只保留同源（截图要读 DOM），不给 allow-scripts。
      iframe.setAttribute('sandbox', 'allow-same-origin')
      document.body.appendChild(iframe)
      await new Promise((resolve) => {
        iframe.onload = resolve
        iframe.srcdoc = html
        setTimeout(resolve, 1800)
      })
      try {
        const doc = iframe.contentDocument
        iframe.style.height = '1px'
        await new Promise((resolve) => setTimeout(resolve, 80))
        const width = 900
        const height = Math.max(600, Math.ceil(doc.documentElement.scrollHeight))
        const clone = doc.documentElement.cloneNode(true)
        clone.querySelectorAll('script').forEach((node) => node.remove())
        const xml = new XMLSerializer().serializeToString(clone)
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${xml}</foreignObject></svg>`
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = () => reject(new Error('图片渲染失败'))
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        })
        const scale = 2
        const canvas = document.createElement('canvas')
        canvas.width = width * scale
        canvas.height = height * scale
        const ctx = canvas.getContext('2d')
        ctx.scale(scale, scale)
        ctx.fillStyle = (() => { try { const bg = getComputedStyle(doc.body).backgroundColor; return bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff' } catch { return '#ffffff' } })()
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('图片生成失败')
        downloadBlob(name, blob)
      } finally {
        iframe.remove()
      }
    }

    function TemplateModal({ date, markdown, onClose, show, ai }) {
      const [template, setTemplate] = useState('')
      const [prompt, setPrompt] = useState('')
      const [busy, setBusy] = useState('')
      const [preview, setPreview] = useState(false)
      const [confirmReset, setConfirmReset] = useState(false)
      const [aiModified, setAiModified] = useState(false)
      const fileRef = useRef(null)
      const off = aiOffOf(ai)
      useEffect(() => {
        request('/report/template').then((data) => setTemplate(data.template ?? '')).catch((error) => show(error.message, 'error'))
      }, [show])
      const save = async () => {
        setBusy('save')
        try { await request('/report/template', { template }); show('模板已保存'); onClose() }
        catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const reset = async () => {
        setConfirmReset(false)
        setBusy('reset')
        try { const data = await request('/report/template/reset', {}); setTemplate(data.template); show(data.backup ? `已恢复默认模板，原模板已备份为 ${data.backup}` : '已恢复默认模板') }
        catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const upload = async (files) => {
        const file = files?.[0]
        if (!file) return
        setBusy('upload')
        try {
          const data = await request('/report/template/upload', { name: file.name, dataBase64: toBase64(await file.arrayBuffer()) })
          setTemplate(data.template)
          show('已载入模板，确认后保存')
        } catch (error) { show(error.message, 'error') } finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
      }
      const aiCommand = async () => {
        if (off) { show(`AI 暂时不可用：${aiReasonOf(ai)}`, 'error'); return }
        if (!prompt.trim()) { show('先写修改要求', 'error'); return }
        setBusy('ai')
        try {
          const data = await request('/report/template/ai', { template, prompt })
          setTemplate(data.template); setAiModified(true)
          show(`AI 已生成新模板（${data.model}），确认后保存`)
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const html = fillTemplate(template, { markdown, date })
      return h('div', { className: 'wb-modal', onClick: (event) => { if (event.target === event.currentTarget) onClose() } },
        h('div', { className: 'wb-modal-card' },
          h('div', { className: 'wb-modal-head' },
            h('div', { className: 'wb-card-title' }, '日报 HTML 模板'),
            h('span', { className: 'wb-badge' }, '占位符 {{content}} / {{tags}}'),
            h('div', { className: 'wb-spacer' }),
            h('button', { className: 'wb-icon-btn', 'aria-label': '关闭', title: '关闭', onClick: onClose }, '×'),
          ),
          h('textarea', { className: 'wb-textarea wb-mono', rows: 14, value: template, onChange: (event) => setTemplate(event.target.value) }),
          h('div', { className: 'wb-row' },
            h('button', { className: 'wb-btn primary', disabled: busy === 'save', onClick: save }, '保存模板'),
            h('button', { className: 'wb-btn', onClick: () => setConfirmReset(true) }, '恢复默认'),
            h('button', { className: 'wb-btn', onClick: () => fileRef.current?.click() }, '上传 HTML'),
            h('input', { ref: fileRef, type: 'file', accept: '.html,.htm', style: { display: 'none' }, onChange: (event) => upload(event.target.files) }),
            h('button', { className: 'wb-btn ghost', onClick: () => setPreview(!preview) }, preview ? '收起预览' : '预览'),
          ),
          confirmReset ? h('div', { className: 'wb-warnbox' },
            h('span', { style: { flex: 1 } }, '恢复默认会覆盖当前自定义模板（原模板会自动备份）。确定继续吗？'),
            h('button', { className: 'wb-btn sm', onClick: () => setConfirmReset(false) }, '取消'),
            h('button', { className: 'wb-btn sm danger-solid', disabled: busy === 'reset', onClick: reset }, busy === 'reset' ? '恢复中…' : '确认恢复')) : null,
          h('div', { className: 'wb-row' },
            h('input', { className: 'wb-input', placeholder: '用一句话说明想怎么改，例如：换成深色卡片、加公司名', value: prompt, onChange: (event) => setPrompt(event.target.value) }),
            h('button', {
              className: 'wb-btn wb-ai-btn', disabled: busy === 'ai' || off,
              title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : 'AI 修改模板',
              onClick: aiCommand,
            }, busy === 'ai' ? h(React.Fragment, null, h(Spinner), 'AI 修改中…') : h(React.Fragment, null, h(SparkIcon), 'AI 修改模板')),
          ),
          off ? h(AiOffHint, { ai, manualText: '仍可直接编辑 HTML 或上传模板。' }) : null,
          aiModified ? h('div', { className: 'wb-ai-note' }, h(AiTag, { model: ai?.model }), '模板已由 AI 修改，右侧预览确认后再保存') : null,
          preview ? h('iframe', { className: 'wb-iframe', sandbox: '', srcDoc: html, title: '模板预览' }) : null,
        ))
    }

    function ReportEditorModal({ date, onClose, refresh, show, ai, initialStep = 1, initialSessionIds = null, initialExtraText = '', initialManual = false, autoGenerate = false }) {
      const [step, setStep] = useState(initialStep)
      const [loaded, setLoaded] = useState(false)
      const [userText, setUserText] = useState(() => {
        try { return window.localStorage?.getItem(`wb.report.text.${date}`) ?? '' } catch { return '' }
      })
      const [extraText, setExtraText] = useState(initialExtraText)
      const [collectData, setCollectData] = useState(null)
      const [selectedSessions, setSelectedSessions] = useState(new Set())
      const [includeMaterial, setIncludeMaterial] = useState(false)
      const [todos, setTodos] = useState([])
      const [selectedTodos, setSelectedTodos] = useState(new Set())
      const [report, setReport] = useState(null)
      const [showSaved, setShowSaved] = useState(false)
      const [tags, setTags] = useState([])
      const [tagsTouched, setTagsTouched] = useState(false)
      const [adoptedTagIds, setAdoptedTagIds] = useState(new Set())
      const [suggestions, setSuggestions] = useState([])
      const [ignoredSuggestions, setIgnoredSuggestions] = useState(new Set())
      const [showEvidence, setShowEvidence] = useState(false)
      const [draft, setDraft] = useState(() => (initialManual ? manualReportDraft(initialExtraText) : ''))
      const [manualMode, setManualMode] = useState(initialManual)
      const [busy, setBusy] = useState('')
      const [runStep, setRunStep] = useState(0)
      const [tagEditor, setTagEditor] = useState(false)
      const fileRef = useRef(null)
      const abortRef = useRef(null)
      const timerRef = useRef(null)
      const draftRef = useRef('')
      const initialSessionsRef = useRef(initialSessionIds)
      const off = aiOffOf(ai)
      const sessions = collectData?.session?.sessions ?? []
      const files = collectData?.files ?? []
      const manual = collectData?.manual ?? []
      const completed = todos.filter((todo) => todo.status === '完成')
      const stepNames = ['写下今天做了什么', '生成草稿', '编辑保存']

      const load = useCallback(async () => {
        try {
          const [collect, reportData, todoData] = await Promise.all([
            request(`/collect?date=${date}`), request(`/report?date=${date}`), request(`/todos?date=${date}`),
          ])
          setCollectData(collect)
          const loadedSessionIds = (collect.session?.sessions ?? []).map((item) => item.sessionId)
          const wanted = initialSessionsRef.current
          setSelectedSessions(new Set(wanted ? loadedSessionIds.filter((id) => wanted.includes(id)) : loadedSessionIds))
          setTodos(todoData.todos ?? [])
          setSelectedTodos(new Set((todoData.todos ?? []).filter((todo) => todo.status === '完成').map((todo) => todo.id)))
          setReport(reportData.exists ? reportData.markdown : null)
          setTags(reportData.tags ?? [])
          setTagsTouched(Boolean(reportData.exists))
        } catch (error) { show(error.message, 'error') } finally { setLoaded(true) }
      }, [date, show])
      useEffect(() => { void load() }, [load])
      useEffect(() => {
        try {
          if (userText.trim()) window.localStorage?.setItem(`wb.report.text.${date}`, userText)
          else window.localStorage?.removeItem(`wb.report.text.${date}`)
        } catch { /* 忽略 */ }
      }, [userText, date])
      useEffect(() => () => {
        if (timerRef.current) clearInterval(timerRef.current)
        abortRef.current?.abort?.()
      }, [])
      useEffect(() => { draftRef.current = draft }, [draft])
      useEffect(() => {
        if (step !== 3 || manualMode || off) {
          setSuggestions([])
          setIgnoredSuggestions(new Set())
          setShowEvidence(false)
          return undefined
        }
        const markdown = draftRef.current
        if (!markdown.trim()) {
          setSuggestions([])
          setIgnoredSuggestions(new Set())
          return undefined
        }
        let alive = true
        request('/report/goal-suggestions', { date, markdown })
          .then((data) => {
            if (!alive) return
            setSuggestions(data.suggestions ?? [])
            setIgnoredSuggestions(new Set())
            setShowEvidence(false)
          })
          .catch(() => { if (alive) setSuggestions([]) })
        return () => { alive = false }
      }, [step, manualMode, off, date])
      const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null } }
      const refreshCollect = async () => {
        const data = await request(`/collect?date=${date}`)
        setCollectData(data)
        setSelectedSessions((current) => new Set([...current, ...(data.session?.sessions ?? []).map((item) => item.sessionId)]))
      }
      const collectSessions = async () => {
        setBusy('collect')
        try {
          const result = await request('/collect/sessions', { date })
          setCollectData((current) => ({ ...(current ?? {}), session: result.session }))
          setSelectedSessions(new Set((result.session?.sessions ?? []).map((item) => item.sessionId)))
          show(result.session?.note ?? '已采集 Harness 会话')
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const upload = async (list) => {
        if (!list?.length) return
        setBusy('upload')
        try {
          const payload = []
          for (const file of list) {
            if (file.size > 30 * 1024 * 1024) { show(`${file.name} 超过 30MB，已跳过`, 'error'); continue }
            payload.push({ name: file.name, dataBase64: toBase64(await file.arrayBuffer()) })
          }
          if (!payload.length) return
          await request('/collect', { date, files: payload })
          await refreshCollect()
          show(`已上传 ${payload.length} 个附件`)
        } catch (error) { show(error.message, 'error') } finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
      }
      const completedSelected = completed.filter((todo) => selectedTodos.has(todo.id))
      const canGenerate = Boolean(userText.trim() || extraText.trim() || selectedSessions.size || completedSelected.length
        || files.length || manual.length || (includeMaterial && collectData?.materialText?.trim()))
      const buildMaterial = () => {
        const parts = []
        if (userText.trim()) parts.push(userText.trim())
        if (extraText.trim()) parts.push(`【补充几句】\n${extraText.trim()}`)
        const pickedSessions = sessions.filter((session) => selectedSessions.has(session.sessionId))
        if (pickedSessions.length) {
          const lines = pickedSessions.map((session, index) => {
            const detail = sessionDetail(session).split('\n').filter(Boolean).map((line) => `  ${line}`).join('\n')
            return `- ${sessionName(session, index)}${session.cwd ? `（${session.cwd}）` : ''}${detail ? `\n${detail}` : ''}`
          })
          parts.push(`【Harness 会话】\n${lines.join('\n')}`)
        } else if (sessions.length) {
          parts.push('（本次不使用 Harness 会话素材）')
        }
        if (manual.length) parts.push(`【人工补充】\n${manual.map((item) => `- ${item.text}`).join('\n')}`)
        if (completedSelected.length) parts.push(`今天完成的待办：\n${completedSelected.map((todo) => `- ${todo.content}`).join('\n')}`)
        if (includeMaterial && collectData?.materialText?.trim()) parts.push(`采集草稿：\n${collectData.materialText.trim()}`)
        // 保证 material 不为空：后端在 material 为空时会回退到「全部会话摘要」，
        // 那会把用户没有勾选的会话也发给模型。
        return parts.join('\n\n') || '（本次未选择任何会话素材，只使用导入文件）'
      }
      const cancelRun = () => {
        abortRef.current?.abort?.()
        abortRef.current = null
        stopTimer()
        setStep(1)
      }
      const generate = async () => {
        if (off) { show(`AI 暂时不可用：${aiReasonOf(ai)}`, 'error'); return }
        if (!canGenerate) { show('先写一点今天做了什么，或勾选素材', 'error'); return }
        setStep(2); setRunStep(0)
        stopTimer()
        timerRef.current = setInterval(() => setRunStep((value) => Math.min(2, value + 1)), 1800)
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
        abortRef.current = controller
        try {
          const payload = { date, materialText: buildMaterial() }
          const result = await request('/generate', payload, controller ? { signal: controller.signal } : undefined)
          setDraft(result.markdown); setManualMode(false); setStep(3)
          show(`草稿已生成（${result.model}），确认后保存`)
        } catch (error) {
          if (error?.name === 'AbortError') show('已取消生成')
          else show(error.message, 'error')
          setStep(1)
        } finally { stopTimer(); abortRef.current = null }
      }
      const manualDraft = () => {
        setDraft(manualReportDraft([userText, extraText].filter((text) => text.trim()).join('\n')))
        setManualMode(true); setStep(3)
      }
      const autoRunRef = useRef(false)
      useEffect(() => {
        if (!autoGenerate || !loaded || autoRunRef.current) return
        if (step !== 2) return
        autoRunRef.current = true
        if (off) { setStep(1); return }
        void generate()
      }, [autoGenerate, loaded, step])
      const save = async (kind) => {
        if (!draft.trim()) { show('草稿为空', 'error'); return }
        setBusy(kind)
        try {
          const payload = {
            date, markdown: draft,
            source: manualMode ? '人工' : 'AI',
            ...(manualMode ? {} : { model: ai?.model }),
          }
          if (tagsTouched) payload.goalIds = tags.map((tag) => tag.id)
          const result = await request('/save-report', payload)
          try { window.localStorage?.removeItem(`wb.report.text.${date}`) } catch { /* 忽略 */ }
          setUserText('')
          await refresh?.()
          if (kind === 'draft') show('草稿已保存到当天的日报')
          else show(`已保存日报；为 ${result.targetDate} 生成 ${result.todos?.length ?? 0} 条待办，关联目标 ${result.tags?.length ?? 0} 个`)
          onClose()
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const sessionName = (session, index) => {
        const first = session.human?.[0] ?? session.assistant?.[0] ?? session.cwd ?? `会话 ${index + 1}`
        return String(first).slice(0, 64)
      }
      const sessionDetail = (session) => [
        session.human?.length ? `用户指令：${session.human.join(' / ')}` : '',
        session.files?.length ? `改动文件：${session.files.slice(0, 12).join('、')}` : '',
        session.assistant?.length ? `助手结论：${session.assistant[0]}` : '',
      ].filter(Boolean).join('\n')
      const allSessionsChecked = sessions.length > 0 && sessions.every((session) => selectedSessions.has(session.sessionId))
      const toggleSessions = () => {
        if (allSessionsChecked) setSelectedSessions(new Set())
        else setSelectedSessions(new Set(sessions.map((session) => session.sessionId)))
      }
      const toggleAllTodos = () => {
        if (completedSelected.length === completed.length) setSelectedTodos(new Set())
        else setSelectedTodos(new Set(completed.map((todo) => todo.id)))
      }
      const adoptSuggestion = (item) => {
        setTags((current) => (current.some((tag) => tag.id === item.goalId) ? current : [...current, { id: item.goalId, title: item.goalTitle, cycle: item.cycle }]))
        setAdoptedTagIds((current) => new Set(current).add(item.goalId))
        setTagsTouched(true)
      }
      const ignoreSuggestion = (item) => {
        setIgnoredSuggestions((current) => new Set(current).add(item.goalId))
      }
      const dropAdoptedTag = (id) => {
        setTags((current) => current.filter((tag) => tag.id !== id))
        setAdoptedTagIds((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })
        setTagsTouched(true)
      }
      const tagRow = h('div', { className: 'wb-row' },
        h('span', { className: 'wb-small wb-muted' }, '关联目标'),
        h('div', { className: 'wb-tags' }, tags.map((tag) => h('span', { key: tag.id, className: 'wb-tag' },
          `${tag.cycle} · ${tag.title}`,
          adoptedTagIds.has(tag.id) ? h('span', { className: 'wb-tag-ai', title: '由「✦ AI 建议关联」采纳' }, '✦') : null,
          adoptedTagIds.has(tag.id) ? h('button', { type: 'button', title: '取消采纳', 'aria-label': '取消采纳', onClick: () => dropAdoptedTag(tag.id) }, '×') : null))),
        h('button', { className: 'wb-btn sm ghost', onClick: () => setTagEditor(true) }, tags.length ? '＋ 关联目标' : '＋ 选择目标'),
        h('span', { className: 'wb-hint' }, tagsTouched ? '保存时按这里的选择关联' : '不选时按日报内容自动匹配'))

      const pendingSuggestions = suggestions.filter((item) => !ignoredSuggestions.has(item.goalId) && !tags.some((tag) => tag.id === item.goalId))
      const showSuggestionRow = !manualMode && !off && pendingSuggestions.length > 0
      const suggestionRow = showSuggestionRow
        ? h('div', { className: 'wb-row', style: { gap: 6, alignItems: 'center' } },
          h('span', { className: 'wb-ai-tag' }, '✦ AI 建议关联'),
          pendingSuggestions.map((item) => h('span', { key: item.goalId, className: 'wb-sugtag', title: `依据：${item.quote}` },
            `${item.cycle} · ${item.goalTitle}`,
            h('span', { className: 'wb-sugtag-lv' }, `把握${item.confidence}`),
            h('button', { type: 'button', title: '采纳', 'aria-label': `采纳：${item.goalTitle}`, onClick: () => adoptSuggestion(item) }, '＋'),
            h('button', { type: 'button', title: '忽略', 'aria-label': `忽略：${item.goalTitle}`, onClick: () => ignoreSuggestion(item) }, '×'))),
          h('button', { type: 'button', className: 'wb-btn sm ghost', onClick: () => setShowEvidence(!showEvidence) }, showEvidence ? '收起依据' : '查看依据'))
        : null
      const suggestionEvidence = showSuggestionRow && showEvidence
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 2 } },
          pendingSuggestions.map((item) => h('div', { key: item.goalId, className: 'wb-evquote' },
            h('b', null, `${item.cycle} · ${item.goalTitle}`), '：', highlightKeyword(item.quote, item.keyword))),
          h('span', { className: 'wb-hint' }, '依据全部来自你日报里的原句。'))
        : null

      const sessionCards = sessions.map((session, index) => h('div', { key: session.sessionId, className: 'wb-srccard sub' },
        h('input', {
          type: 'checkbox', checked: selectedSessions.has(session.sessionId),
          onChange: () => setSelectedSessions((current) => {
            const next = new Set(current)
            if (next.has(session.sessionId)) next.delete(session.sessionId); else next.add(session.sessionId)
            return next
          }),
          'aria-label': '选择这段会话',
        }),
        h('div', { className: 'wb-srccard-body' },
          h('b', { style: { fontWeight: 500 } }, `${index + 1}. ${sessionName(session, index)}`),
          h('div', { className: 'wb-small' }, [session.cwd, session.files?.length ? `${session.files.length} 个文件` : ''].filter(Boolean).join(' · ')),
          sessionDetail(session) ? h('details', null,
            h('summary', null, '展开原文'),
            h('div', { className: 'wb-small' }, sessionDetail(session))) : null,
        ),
      ))

      const stepBody = step === 1
        ? h(React.Fragment, null,
          report ? h('div', { className: 'wb-warnbox' },
            h('span', null, '⚠'),
            h('span', { style: { flex: 1 } }, '这天已有日报。重新生成只会替换草稿，确认保存前不会覆盖已保存的日报。'),
            h('button', { className: 'wb-btn sm ghost', onClick: () => setShowSaved(!showSaved) }, showSaved ? '收起' : '查看已保存的日报')) : null,
          off ? h(AiOffHint, { ai, manualText: '可以先用「不用 AI，直接手写」；你写的内容会保留。' }) : null,
          h('label', { className: 'wb-form-field' },
            h('span', null, date === todayKey() ? '今天做了什么？' : `${date} 这天做了什么？`),
            h('textarea', {
              className: 'wb-textarea', style: { minHeight: 110 }, value: userText,
              placeholder: '随便写几句就行，例如：\n上午和张三对齐了登录改造的验收标准；\n下午补完回归用例，还差 2 个接口没联调。',
              onChange: (event) => setUserText(event.target.value),
            }),
            h('span', { className: 'wb-hint' }, 'AI 会把你写的内容和下面勾选的素材合在一起，整理成日报')),
          showSaved && report ? h('div', { className: 'wb-card', style: { background: 'var(--wb-surface-2)' } }, renderMarkdown(report)) : null,
          h('div', { className: 'wb-row' },
            h('b', { className: 'wb-small' }, '素材'),
            h('span', { className: 'wb-hint' }, '已整理成摘要，可以展开看原文'),
            h('div', { className: 'wb-spacer' }),
            h('button', { className: 'wb-btn sm ghost', disabled: busy === 'collect', onClick: collectSessions },
              busy === 'collect' ? h(React.Fragment, null, h(Spinner), '采集中…') : h(React.Fragment, null, h(RefreshIcon), '从 Harness 会话采集'))),
          h('div', { className: 'wb-srccard' },
            h('input', { type: 'checkbox', checked: allSessionsChecked, onChange: toggleSessions, 'aria-label': '选择全部 Harness 会话' }),
            h('div', { className: 'wb-srccard-body' },
              h('b', null, `Harness 会话 · ${sessions.length ? `${sessions.length} 段` : '还没采集'}`),
              h('div', { className: 'wb-small' }, collectData?.session?.note ?? '点右上角「从 Harness 会话采集」，把今天的会话整理进来。'),
              sessionCards),
          ),
          completed.length ? h('div', { className: 'wb-srccard' },
            h('input', { type: 'checkbox', checked: completedSelected.length === completed.length, onChange: toggleAllTodos, 'aria-label': '选择今天完成的待办' }),
            h('div', { className: 'wb-srccard-body' },
              h('b', null, `今天完成的待办 · ${completed.length} 项`),
              h('div', { className: 'wb-small' }, completed.slice(0, 8).map((todo) => todo.content).join('；')))) : null,
          files.length ? h('div', { className: 'wb-srccard' },
            h('div', { className: 'wb-srccard-body' },
              h('b', null, `导入附件 · ${files.length} 个`),
              h('div', { className: 'wb-small' }, files.map((file) => `${file.name}（${file.via}，${file.chars ?? file.text?.length ?? 0} 字）`).join('；')))) : null,
          manual.length ? h('div', { className: 'wb-srccard' },
            h('div', { className: 'wb-srccard-body' },
              h('b', null, `人工补充 · ${manual.length} 条`),
              h('div', { className: 'wb-small' }, manual.map((item) => item.text).join('；')))) : null,
          collectData?.materialText?.trim() ? h('div', { className: 'wb-srccard' },
            h('input', { type: 'checkbox', checked: includeMaterial, onChange: () => setIncludeMaterial(!includeMaterial), 'aria-label': '选择采集草稿' }),
            h('div', { className: 'wb-srccard-body' },
              h('b', null, '采集草稿（原始素材）'),
              h('div', { className: 'wb-small' }, '之前从会话整理出的草稿，默认不参与生成，避免和上面的会话重复。'),
              h('details', null, h('summary', null, '展开原文'), h('div', { className: 'wb-small' }, collectData.materialText)))) : null,
          h('div', { className: 'wb-srccard', style: { borderStyle: 'dashed' } },
            h('div', { className: 'wb-srccard-body' },
              h('b', null, '上传附件'),
              h('div', { className: 'wb-small' }, '支持 .md / .txt / .docx / .xlsx / .pptx，最大 30MB')),
            h('button', { className: 'wb-btn sm', disabled: busy === 'upload', onClick: () => fileRef.current?.click() }, busy === 'upload' ? '上传中…' : '选择文件'),
            h('input', { ref: fileRef, type: 'file', multiple: true, style: { display: 'none' }, accept: '.md,.markdown,.txt,.docx,.doc,.xlsx,.xls,.pptx,.ppt', onChange: (event) => upload(event.target.files) })),
        )
        : step === 2
          ? h('div', { className: 'wb-ai-panel' },
            h('div', { className: 'wb-row' },
              h(AiSteps, { steps: ['读取素材', '整理成日报', '生成结构'], step: runStep }),
              h('div', { className: 'wb-spacer' }),
              h('div', { className: 'wb-hint' }, `${String(ai?.model ?? '').split('/').pop() || '模型'} 正在整理，通常需要 10–20 秒`)),
            h('div', { className: 'wb-progress ai' }, h('i', { style: { width: `${Math.min(96, (runStep + 1) * 30)}%` } })))
          : h(React.Fragment, null,
            manualMode
              ? h('div', { className: 'wb-ai-note manual' }, '✍ 手写模式：已按日报模板排好，直接修改就行。这份日报不会带 AI 标签。')
              : h('div', { className: 'wb-ai-note' }, h(AiTag, { model: ai?.model }), '以下草稿由 AI 生成，请检查后再保存。'),
            h('div', { className: 'wb-edit-split' },
              h('textarea', {
                className: 'wb-textarea', value: draft, 'aria-label': '日报草稿',
                onChange: (event) => setDraft(event.target.value),
              }),
              h('div', { className: 'wb-preview-pane' }, renderMarkdown(draft))),
            tagRow,
            suggestionRow,
            suggestionEvidence,
          )
      const footer = step === 1
        ? [
          h('button', { key: 'cancel', className: 'wb-btn', onClick: onClose, style: { marginRight: 'auto' } }, '取消'),
          h('button', { key: 'manual', className: 'wb-btn ghost', onClick: manualDraft, title: '不用 AI，按模板排好，自己写' }, '不用 AI，直接手写'),
          h('button', {
            key: 'gen', className: 'wb-btn ai', disabled: off || !canGenerate,
            title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : '生成日报草稿',
            onClick: generate,
          }, h(SparkIcon), '生成日报草稿'),
        ]
        : step === 2
          ? [h('button', { key: 'cancel', className: 'wb-btn', onClick: cancelRun }, '取消生成')]
          : [
            h('button', { key: 'back', className: 'wb-btn', onClick: () => setStep(1), style: { marginRight: 'auto' } }, '上一步'),
            manualMode ? null : h('button', {
              key: 'regen', className: 'wb-btn ai-2', disabled: off, title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : '重新生成',
              onClick: generate,
            }, h(SparkIcon), '重新生成'),
            h('button', { key: 'draft', className: 'wb-btn', disabled: Boolean(busy), onClick: () => save('draft') }, busy === 'draft' ? '保存中…' : '保存草稿'),
            h('button', { key: 'save', className: 'wb-btn primary', disabled: Boolean(busy), onClick: () => save('save') }, busy === 'save' ? '保存中…' : '确认保存'),
          ]
      return h(React.Fragment, null,
        h(Modal, { title: `${date} 日报`, onClose, size: step === 3 ? 'xl' : 'lg', footer },
          h('div', { className: 'wb-report-steps' },
            stepNames.map((name, indexNumber) => h('div', {
              key: name, className: `wb-report-step${step === indexNumber + 1 ? ' on' : step > indexNumber + 1 ? ' ok' : ''}`,
            }, h('b', null, step > indexNumber + 1 ? '✓' : indexNumber + 1), name))),
          !loaded ? h('div', { className: 'wb-card' }, h(Skeleton, { rows: 5 })) : stepBody),
        tagEditor ? h(GoalTagEditor, {
          date, tags, show, ai,
          onClose: () => setTagEditor(false),
          onSaved: async () => {
            const data = await request(`/report?date=${date}`)
            setTags(data.tags ?? []); setTagsTouched(true)
          },
        }) : null,
      )
    }

    function ReportViewerModal({ date, onClose, refresh, show, onNew }) {
      const [markdown, setMarkdown] = useState(null)
      const [tags, setTags] = useState([])
      const [todos, setTodos] = useState([])
      const [editing, setEditing] = useState(false)
      const [busy, setBusy] = useState('')
      const [sourceInfo, setSourceInfo] = useState({ source: null, model: null, updatedAt: null, mtime: 0 })
      const load = useCallback(async () => {
        try {
          const [data, tasks] = await Promise.all([request(`/report?date=${date}`), request(`/todos?date=${date}`)])
          setMarkdown(data.exists ? data.markdown : ''); setTags(data.tags ?? []); setTodos(tasks.todos ?? [])
          setSourceInfo({ source: data.source ?? null, model: data.model ?? null, updatedAt: data.updatedAt ?? null, mtime: data.mtime ?? 0 })
        } catch (error) { show(error.message, 'error') }
      }, [date, show])
      useEffect(() => { void load() }, [load])
      const empty = markdown !== null && !String(markdown).trim()
      const taskCard = h('div', { className: 'wb-card', style: { padding: '10px 12px' } },
        h('div', { className: 'wb-card-head' }, h('div', { className: 'wb-card-title' }, '当天任务'), h('span', { className: 'wb-badge' }, `${todos.length} 项`)),
        todos.length
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } }, todos.map((todo) => h('div', { key: todo.id, style: { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12 } },
            h('span', { style: { color: todo.status === '完成' ? '#10b981' : 'var(--wb-muted)', width: 14 } }, todo.status === '完成' ? '✓' : '○'),
            h('span', { style: { flex: 1, textDecoration: todo.status === '完成' ? 'line-through' : 'none', opacity: todo.status === '完成' ? .6 : 1 } }, todo.content),
            h('span', { className: 'wb-small wb-muted' }, todo.dueDate && /\d{2}:\d{2}/.test(todo.dueDate) ? todo.dueDate.slice(11) : ''),
          )))
          : h('div', { className: 'wb-empty' }, '这天没有待办'),
      )
      const modified = sourceInfo.updatedAt
        ? formatLocalStamp(sourceInfo.updatedAt)
        : sourceInfo.mtime ? formatLocalStamp(new Date(sourceInfo.mtime).toISOString()) : '—'
      const metaRow = h('div', { className: 'wb-row', style: { fontSize: 11, color: 'var(--wb-text-3)', gap: 6 } },
        sourceInfo.source === 'AI' ? h(AiTag, { model: sourceInfo.model }) : null,
        h('span', null, sourceInfo.source === 'AI'
          ? `由 ${String(sourceInfo.model ?? '').split('/').pop() || 'AI'} 根据当天素材生成`
          : `来源：${sourceInfo.source === '人工' ? '手写' : '日报文件'}`),
        h('span', null, `· 最后修改 ${modified}`))
      const tagRow = h('div', { className: 'wb-row' },
        h('div', { className: 'wb-tags' }, tags.map((tag) => h('span', { key: tag.id, className: 'wb-tag' }, `${tag.cycle} · ${tag.title}`))),
        h('div', { className: 'wb-spacer' }),
        editing ? h('button', { className: 'wb-btn ghost', onClick: () => { setEditing(false); void load() } }, '取消') : h('button', { className: 'wb-btn ghost', onClick: () => setEditing(true) }, '编辑'),
      )
      return h(Modal, { title: date, wide: true, onClose },
        taskCard,
        markdown === null ? h('div', { className: 'wb-empty' }, '加载中…')
          : empty
            ? h('div', { className: 'wb-card' },
              h('div', { className: 'wb-row' },
                h('div', { className: 'wb-empty' }, '这一天还没有日报'),
                h('div', { className: 'wb-spacer' }),
                h('button', { className: 'wb-btn primary', onClick: () => { onNew(date); onClose() } }, '新建日报')))
            : editing
              ? h('div', { className: 'wb-card' }, metaRow, tagRow,
                h('textarea', { className: 'wb-textarea', rows: 16, value: markdown, onChange: (event) => setMarkdown(event.target.value) }),
                h('div', { className: 'wb-row end' }, h('button', { className: 'wb-btn primary', disabled: busy === 'save', onClick: async () => { setBusy('save'); try { await request('/save-report', { date, markdown }); await load(); setEditing(false); await refresh?.(); show('已保存') } catch (error) { show(error.message, 'error') } finally { setBusy('') } } }, '保存')))
              : h('div', { className: 'wb-card' }, metaRow, tagRow, renderMarkdown(markdown)),
      )
    }

    function VStack({ storageKey, children }) {
      const items = React.Children.toArray(children)
      const ref = useRef(null)
      const [sizes, setSizes] = useState(() => {
        try {
          const saved = JSON.parse(window.localStorage?.getItem(storageKey) ?? 'null')
          if (Array.isArray(saved) && saved.length === items.length) return saved
        } catch { /* 忽略 */ }
        return items.map(() => 0)
      })
      const dragRef = useRef(null)
      const onDown = (index, event) => {
        const nodes = ref.current ? [...ref.current.children].filter((node) => node.classList.contains('wb-vitem')) : []
        if (nodes.length !== items.length) return
        event.preventDefault()
        const heights = nodes.map((node) => node.getBoundingClientRect().height)
        dragRef.current = { index, startY: event.clientY, heights }
        document.body.classList.add('wb-vdragging')
        const move = (moveEvent) => {
          const drag = dragRef.current
          if (!drag) return
          const dy = moveEvent.clientY - drag.startY
          const next = [...drag.heights]
          next[drag.index] = Math.max(120, drag.heights[drag.index] + dy)
          next[drag.index + 1] = Math.max(120, drag.heights[drag.index + 1] - dy)
          setSizes(next)
        }
        const up = () => {
          dragRef.current = null
          document.body.classList.remove('wb-vdragging')
          document.removeEventListener('mousemove', move)
          document.removeEventListener('mouseup', up)
          setSizes((current) => {
            try { window.localStorage?.setItem(storageKey, JSON.stringify(current)) } catch { /* 忽略 */ }
            return current
          })
        }
        document.addEventListener('mousemove', move)
        document.addEventListener('mouseup', up)
      }
      return h('div', { className: 'wb-vstack', ref },
        items.map((node, index) => h(React.Fragment, { key: index },
          h('div', { className: 'wb-vitem', style: sizes[index] ? { flex: `0 0 ${sizes[index]}px` } : { flex: '1 1 0' } }, node),
          index < items.length - 1 ? h('div', { className: 'wb-vsplit', title: '拖动调整高度', onMouseDown: (event) => onDown(index, event) }) : null,
        )))
    }

    function AssistantCard({ state, refresh, show }) {
      const [text, setText] = useState('')
      const [url, setUrl] = useState('')
      const [files, setFiles] = useState([])
      const [notes, setNotes] = useState([])
      const [preview, setPreview] = useState([])
      const [phase, setPhase] = useState('idle')
      const [step, setStep] = useState(0)
      const [busy, setBusy] = useState('')
      const fileRef = useRef(null)
      const runRef = useRef(null)
      const stepTimer = useRef(null)
      const panelRef = useRef(null)
      const ai = state.ai
      const off = aiOffOf(ai)
      const steps = ['读取文字、链接和附件', '拆解任务', '推断日期']
      useEffect(() => () => {
        if (stepTimer.current) clearInterval(stepTimer.current)
        runRef.current?.abort?.()
      }, [])
      useEffect(() => {
        if (phase === 'done' && preview.length) panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }, [phase, preview.length])
      const addFiles = async (list) => {
        const next = [...files]
        for (const file of list ?? []) {
          if (file.size > 30 * 1024 * 1024) { show(`${file.name} 超过 30MB`, 'error'); continue }
          next.push({ name: file.name, size: file.size, dataBase64: toBase64(await file.arrayBuffer()) })
        }
        setFiles(next); if (fileRef.current) fileRef.current.value = ''
      }
      const stopTimer = () => { if (stepTimer.current) { clearInterval(stepTimer.current); stepTimer.current = null } }
      const cancel = () => {
        runRef.current?.abort?.()
        runRef.current = null
        stopTimer()
        setPhase('idle'); setStep(0); setBusy('')
      }
      const run = async () => {
        if (off) { show(`AI 暂时不可用：${aiReasonOf(ai)}`, 'error'); return }
        if (!text.trim() && !url.trim() && !files.length) { show('写点什么、贴个链接或加个附件', 'error'); return }
        if (busy === 'run') return
        setBusy('run'); setPhase('running'); setStep(0); setPreview([]); setNotes([])
        stopTimer()
        stepTimer.current = setInterval(() => setStep((value) => Math.min(steps.length - 1, value + 1)), 4200)
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
        runRef.current = controller
        try {
          const result = await request('/assistant/analyze', { text, url, files }, controller ? { signal: controller.signal } : undefined)
          const items = result.items ?? []
          setNotes(result.notes ?? [])
          if (!items.length) { show('没有拆出待办，换个说法再试一次', 'error'); setPhase('idle'); return }
          setPreview(items.map((item, index) => ({
            key: `${index}-${item.content}`, content: item.content,
            date: String(item.date || todayKey()).slice(0, 10), checked: true,
          })))
          setPhase('done'); setStep(steps.length - 1)
          show(`AI 拆出 ${items.length} 条，确认后添加`)
        } catch (error) {
          if (error?.name === 'AbortError') { show('已取消 AI 分析'); setPhase('idle') }
          else { show(error.message, 'error'); setPhase('idle') }
        } finally {
          stopTimer(); setBusy(''); runRef.current = null
        }
      }
      const addSelected = async () => {
        const picked = preview.filter((item) => item.checked)
        if (!picked.length) { show('先勾选要添加的待办', 'error'); return }
        setBusy('add')
        try {
          const createdIds = []
          for (const item of picked) {
            const result = await request('/todos/add', {
              date: item.date, texts: [item.content], dueDate: item.date, startDate: item.date,
              source: 'AI 助手', aiModel: ai?.model ?? state.model,
            })
            for (const created of result.created ?? []) createdIds.push(created.id)
          }
          const count = picked.length
          setPreview([]); setPhase('idle'); setStep(0); setText(''); setUrl(''); setFiles([])
          await refresh()
          show(`已添加 ${count} 条 AI 生成的待办`, 'ok', async () => {
            try {
              for (const id of createdIds) await request('/todos/delete', { id })
              await refresh(); show('已撤销添加')
            } catch (error) { show(error.message, 'error') }
          })
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const panel = phase === 'running'
        ? h('div', { className: 'wb-ai-panel', 'aria-live': 'polite' },
          h('div', { className: 'wb-row' },
            h(AiSteps, { steps, step }),
            h('div', { className: 'wb-spacer' }),
            h('button', { className: 'wb-btn sm ghost', onClick: cancel }, '取消')),
          h('div', { className: 'wb-progress ai' }, h('i', { style: { width: `${Math.min(96, (step + 1) * 32)}%` } })),
          h('div', { className: 'wb-hint' }, `${String(ai?.model ?? state.model ?? '').split('/').pop()} 正在分析，通常需要 10–20 秒`))
        : phase === 'done'
          ? h('div', { className: 'wb-ai-panel', ref: panelRef, 'aria-live': 'polite' },
            h('div', { className: 'wb-row' },
              h(AiTag, { model: ai?.model ?? state.model }),
              h('b', { style: { fontSize: 12 } }, `拆出 ${preview.length} 条，确认后添加`),
              h('div', { className: 'wb-spacer' }),
              h('span', { className: 'wb-hint' }, '可以改内容和日期')),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
              preview.map((item, index) => h('div', { key: item.key, className: 'wb-ai-item' },
                h('button', {
                  type: 'button', className: `wb-check sel${item.checked ? ' on' : ''}`, role: 'checkbox',
                  'aria-checked': item.checked, 'aria-label': '选择这一条',
                  onClick: () => setPreview(preview.map((entry, i) => i === index ? { ...entry, checked: !entry.checked } : entry)),
                }),
                h('input', {
                  className: 'wb-input', value: item.content, 'aria-label': '待办内容',
                  onChange: (event) => setPreview(preview.map((entry, i) => i === index ? { ...entry, content: event.target.value } : entry)),
                }),
                h(DateField, {
                  chip: true, value: item.date,
                  onChange: (next) => setPreview(preview.map((entry, i) => i === index ? { ...entry, date: next } : entry)),
                }),
              ))),
            notes.length ? h('div', { className: 'wb-hint' }, `AI 说明：${notes.join('；')}`) : null,
            h('div', { className: 'wb-row end' },
              h('button', { className: 'wb-btn sm ghost', onClick: () => { setPreview([]); setPhase('idle'); setStep(0) } }, '取消'),
              h('button', {
                className: 'wb-btn sm ai', disabled: busy === 'add' || !preview.some((item) => item.checked), onClick: addSelected,
              }, busy === 'add' ? h(Spinner) : null, busy === 'add' ? '添加中…' : `添加选中（${preview.filter((item) => item.checked).length}）`)),
          )
          : null
      return h('div', { className: 'wb-card', id: 'ai-card' },
        h('div', { className: 'wb-card-head' },
          h('div', { className: 'wb-card-title', style: { display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--wb-ai)' } },
            h(SparkIcon), ' AI 助手'),
          h('span', { className: 'wb-badge' }, String(ai?.model ?? state.model ?? '跟随 Harness').split('/').pop())),
        h('div', { className: 'wb-assist' },
          h('div', { className: 'wb-assist-hint' }, '说一段话、贴链接或加附件（文档会解析；图片、视频只接收不解析），拆成待办。先预览，确认后才添加。'),
          off ? h(AiOffHint, { ai, manualText: '输入的内容会保留；可以先手动新增待办，恢复后再拆解。' }) : null,
          h('textarea', { className: 'wb-textarea wb-assist-ta', placeholder: '例如：先灰度 60%，补回归用例，找张三确认上线时间', value: text, onChange: (event) => setText(event.target.value) }),
          h('div', { className: 'wb-row' },
            h('span', { className: 'wb-muted' }, '🔗'),
            h('input', { className: 'wb-input', style: { flex: 1, minWidth: 0 }, placeholder: '粘贴链接，AI 会抓取正文一起分析（可选）', value: url, onChange: (event) => setUrl(event.target.value) })),
          files.length ? h('div', { className: 'wb-assist-files' }, files.map((file, index) => h('span', { key: `${file.name}-${index}`, className: 'wb-assist-file' }, file.name, h('button', { onClick: () => setFiles(files.filter((_, i) => i !== index)) }, '×')))) : null,
          h('div', { className: 'wb-row' },
            h('button', { className: 'wb-btn sm ghost', onClick: () => fileRef.current?.click() }, '＋ 附件'),
            h('input', { ref: fileRef, type: 'file', multiple: true, style: { display: 'none' }, accept: '.md,.markdown,.txt,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm', onChange: (event) => addFiles(event.target.files) }),
            h('div', { className: 'wb-spacer' }),
            h('button', {
              className: 'wb-btn ai', disabled: busy === 'run' || off,
              title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : 'AI 拆解待办',
              onClick: run,
            }, busy === 'run' ? h(Spinner) : h(SparkIcon), busy === 'run' ? '分析中…' : 'AI 拆解待办')),
          panel,
        ),
      )
    }

    function CalendarPanel({ refresh, show, state, ai }) {
      const [cursor, setCursor] = useState(() => todayKey())
      const [view, setView] = useState(() => {
        try { return window.localStorage?.getItem('wb.calendar.view') === 'week' ? 'week' : 'month' } catch { return 'month' }
      })
      const [reports, setReports] = useState([])
      const [todos, setTodos] = useState([])
      const [viewer, setViewer] = useState(null)
      const [editor, setEditor] = useState(null)
      const cursorDate = dateOfKey(cursor) ?? nowInZone()
      const year = cursorDate.getFullYear(); const index = cursorDate.getMonth()
      const cells = useMemo(() => {
        if (view === 'week') {
          const monday = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), cursorDate.getDate() - ((cursorDate.getDay() + 6) % 7))
          return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i))
        }
        const first = new Date(cursorDate.getFullYear(), cursorDate.getMonth(), 1)
        const offset = (first.getDay() + 6) % 7
        return Array.from({ length: 42 }, (_, i) => new Date(first.getFullYear(), first.getMonth(), 1 - offset + i))
      }, [cursor, view])
      const from = keyOf(cells[0]); const to = keyOf(cells[cells.length - 1])
      const rangeKey = `${from}|${to}`
      const loadTodos = useCallback(async () => {
        try {
          const data = await request(`/todos?from=${from}&to=${to}`)
          setTodos(data.todos ?? [])
        } catch { /* 日历待办取不到不影响看日报 */ }
      }, [rangeKey])
      const load = useCallback(async () => {
        try { const data = await request('/reports'); setReports((data.reports ?? []).filter((item) => item.kind === '日报')) }
        catch (error) { show(error.message, 'error') }
        await loadTodos()
      }, [show, loadTodos])
      useEffect(() => { void load() }, [load])
      const reloadAll = async () => { await load(); await refresh?.() }
      const reportByDate = useMemo(() => { const map = new Map(); for (const item of reports) map.set(item.date, item); return map }, [reports])
      const todoByDate = useMemo(() => {
        const map = new Map()
        for (const todo of todos) {
          const list = map.get(todo.date) ?? []
          list.push(todo)
          map.set(todo.date, list)
        }
        return map
      }, [todos])
      const today = todayKey()
      const setViewAndSave = (next) => {
        setView(next)
        try { window.localStorage?.setItem('wb.calendar.view', next) } catch { /* 忽略 */ }
      }
      const step = (dir) => setCursor(view === 'week' ? shiftKey(cursor, dir * 7) : shiftMonthKey(cursor, dir))
      const monthPrefix = `${year}-${pad2(index + 1)}`
      const monthReports = reports.filter((item) => String(item.date).startsWith(monthPrefix)).length
      const monthBody = h('div', { className: 'wb-cal2-grid' }, cells.map((cell, cellIndex) => {
        const key = keyOf(cell); const item = reportByDate.get(key); const out = cell.getMonth() !== index
        const pending = (todoByDate.get(key) ?? []).filter((todo) => todo.status !== '完成').length
        return h('button', {
          key: `${key}-${cellIndex}`, type: 'button',
          className: `wb-cal2-cell${out ? ' out' : ''}${key === today ? ' today' : ''}`,
          onClick: () => setViewer(key),
          'aria-label': `${friendlyDate(key)}${item ? '，有日报' : ''}${pending ? `，${pending} 项待办` : ''}`,
          title: item ? `${key} · ${item.title}` : `${key} 新建日报`,
        },
          h('span', { className: 'wb-cal2-day' },
            h('span', { className: 'wb-cal2-daynum' }, cell.getDate()),
            pending && !out ? h('span', { className: 'wb-cal2-count' }, `${pending} 项`) : null),
          item && !out ? h('span', { className: 'wb-cal2-chip' }, h('i', { className: 'wb-cal2-dot' }), (item.title ?? '日报').slice(0, 12)) : null)
      }))
      const weekBody = h('div', { className: 'wb-week' }, cells.map((cell) => {
        const key = keyOf(cell); const item = reportByDate.get(key)
        const dayTodos = todoByDate.get(key) ?? []
        const openItems = dayTodos.filter((todo) => todo.status !== '完成')
        return h('button', {
          key, type: 'button', className: `wb-week-col${key === today ? ' today' : ''}`,
          onClick: () => setViewer(key), title: `${friendlyDate(key)}${item ? ' · 有日报' : ''}`,
        },
          h('h4', null,
            h('span', null, `${WEEKDAYS[cell.getDay()]} ${cell.getDate()}`),
            h('small', null, `${cell.getMonth() + 1}月`)),
          item ? h('span', { className: 'wb-week-ev rep', title: item.title }, `日报 · ${String(item.title ?? '').slice(0, 12)}`) : null,
          openItems.slice(0, 4).map((todo) => h('span', { key: todo.id, className: 'wb-week-ev', title: todo.content }, todo.content)),
          openItems.length > 4 ? h('span', { className: 'wb-week-more' }, `还有 ${openItems.length - 4} 项`) : null,
        )
      }))
      return h('div', { className: 'wb-card', style: { minHeight: 0 } },
        h('div', { className: 'wb-cal2' },
          h('div', { className: 'wb-cal2-head' },
            h('div', { className: 'wb-cal2-title' }, `${index + 1} 月`), h('div', { className: 'wb-cal2-year' }, `${year}`),
            h('div', { className: 'wb-spacer' }),
            h('div', { className: 'wb-seg', role: 'group', 'aria-label': '日历视图' },
              h('button', { className: view === 'month' ? 'on' : '', onClick: () => setViewAndSave('month') }, '月'),
              h('button', { className: view === 'week' ? 'on' : '', onClick: () => setViewAndSave('week') }, '周')),
            h('button', { className: 'wb-cal2-nav', title: '上一年', 'aria-label': '上一年', onClick: () => setCursor(shiftMonthKey(cursor, -12)) }, '«'),
            h('button', { className: 'wb-cal2-nav', title: view === 'week' ? '上一周' : '上个月', 'aria-label': view === 'week' ? '上一周' : '上个月', onClick: () => step(-1) }, '‹'),
            h('button', { className: 'wb-btn sm ghost', onClick: () => setCursor(todayKey()) }, '今天'),
            h('button', { className: 'wb-cal2-nav', title: view === 'week' ? '下一周' : '下个月', 'aria-label': view === 'week' ? '下一周' : '下个月', onClick: () => step(1) }, '›'),
            h('button', { className: 'wb-cal2-nav', title: '下一年', 'aria-label': '下一年', onClick: () => setCursor(shiftMonthKey(cursor, 12)) }, '»'),
          ),
          view === 'month'
            ? h(React.Fragment, null,
              h('div', { className: 'wb-cal2-week' }, ['一', '二', '三', '四', '五', '六', '日'].map((day) => h('span', { key: day }, day))),
              monthBody)
            : weekBody,
        ),
        h('div', { className: 'wb-cal2-foot' },
          h('button', { className: 'wb-btn ai sm', onClick: () => setEditor(today) }, h(SparkIcon), '新建今天日报'),
          h('button', { className: 'wb-btn sm ghost', onClick: () => { void reloadAll() } }, h(RefreshIcon), '刷新'),
          h('div', { className: 'wb-spacer' }),
          h('span', { className: 'wb-small wb-muted' }, `本月 ${monthReports} 份日报`),
        ),
        viewer ? h(ReportViewerModal, { date: viewer, onClose: () => setViewer(null), refresh: reloadAll, show, ai, onNew: (date) => setEditor(date) }) : null,
        editor ? h(ReportEditorModal, { date: editor, onClose: () => setEditor(null), refresh: reloadAll, show, ai }) : null,
      )
    }

    function validDateKey(value) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) return false
      const parsed = dateOfKey(value)
      return Boolean(parsed) && keyOf(parsed) === value
    }

    function SummaryModal({ date, initialPeriod = 'week', ai, onClose, show, onSaved }) {
      const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(date)) ? date : todayKey()
      const initialMode = initialPeriod === 'month' ? 'month' : 'week'
      const initialRange = defaultSummaryRange(initialMode, anchor)
      const [mode, setMode] = useState(initialMode)
      const [start, setStart] = useState(initialRange.from)
      const [end, setEnd] = useState(initialRange.to)
      const [popOpen, setPopOpen] = useState(false)
      const [draft, setDraft] = useState({ from: initialRange.from, to: initialRange.to })
      const [hover, setHover] = useState('')
      const [viewMonth, setViewMonth] = useState(initialRange.from.slice(0, 7))
      const [inputStart, setInputStart] = useState(initialRange.from)
      const [inputEnd, setInputEnd] = useState(initialRange.to)
      const [rangeError, setRangeError] = useState('')
      const [output, setOutput] = useState('')
      const [generated, setGenerated] = useState(false)
      const [edited, setEdited] = useState(false)
      const [model, setModel] = useState('')
      const [runStep, setRunStep] = useState(null)
      const [runKeys, setRunKeys] = useState([])
      const [runIndex, setRunIndex] = useState(0)
      const [audiences, setAudiences] = useState({ boss: true })
      const [customAudienceOn, setCustomAudienceOn] = useState(false)
      const [customAudience, setCustomAudience] = useState('')
      const [versions, setVersions] = useState(null)
      const [currentVersion, setCurrentVersion] = useState('')
      const [reportDays, setReportDays] = useState([])
      const abortRef = useRef(null)
      const stepTimer = useRef(null)
      const runSnapshot = useRef(null)
      const rangeRef = useRef(null)
      const off = aiOffOf(ai)
      const today = todayKey()
      const days = Math.max(1, daysBetweenKeys(start, end))
      const dayKeys = []
      for (let index = 0; index < days; index += 1) dayKeys.push(shiftKey(start, index))
      const reportSet = new Set(reportDays)
      const covered = dayKeys.filter((key) => reportSet.has(key)).length
      const natural = (() => {
        const range = defaultSummaryRange(mode, start)
        return range.from === start && range.to === end
      })()
      const label = mode === 'week' ? '周报' : '月报'
      const displayName = natural
        ? mode === 'week' ? `${isoWeekKeyOf(start)} 周报` : `${start.slice(0, 7)} 月报`
        : `${start} ~ ${end.slice(5)} ${label}`
      const fileKey = natural
        ? mode === 'week' ? isoWeekKeyOf(start) : start.slice(0, 7)
        : `custom-${start}_${end}`
      const selectedAudiences = (() => {
        const list = SUMMARY_AUDIENCES.filter((item) => audiences[item.key]).map((item) => item.label)
        const custom = customAudience.replace(/\s+/g, ' ').trim().slice(0, 30)
        if (customAudienceOn && custom && !list.includes(custom)) list.push(custom)
        return list
      })()
      const audienceCount = selectedAudiences.length
      const versionList = versions ?? []
      const currentVersionItem = versionList.length ? (versionList.find((item) => item.key === currentVersion) ?? versionList[0]) : null
      const primaryContent = versionList.length ? versionList[0].content : output
      const generateLabel = audienceCount > 1 ? `生成 ${audienceCount} 个版本` : `生成${label}`
      const generateTitle = off
        ? 'AI 暂不可用，可直接手写'
        : covered === 0 ? '所选范围内没有日报' : audienceCount === 0 ? '请至少选一位读者' : ''
      const modelShort = String(ai?.model ?? '').split('/').pop() || '当前模型'
      const toggleAudience = (key) => setAudiences((current) => ({ ...current, [key]: !current[key] }))
      const updateVersionContent = (key, content) => setVersions((current) => (current ?? []).map((item) => (item.key === key ? { ...item, content } : item)))
      const presets = mode === 'week'
        ? [
          ['本周', defaultSummaryRange('week', anchor)],
          ['上周', defaultSummaryRange('week', shiftKey(anchor, -7))],
          ['最近 7 天', { from: shiftKey(anchor, -6), to: anchor }],
          ['最近 14 天', { from: shiftKey(anchor, -13), to: anchor }],
        ]
        : [
          ['本月', defaultSummaryRange('month', anchor)],
          ['上月', defaultSummaryRange('month', shiftMonthKey(anchor, -1))],
          ['最近 30 天', { from: shiftKey(anchor, -29), to: anchor }],
          ['最近 90 天', { from: shiftKey(anchor, -89), to: anchor }],
        ]
      useEffect(() => {
        request('/reports')
          .then((data) => setReportDays((data.reports ?? []).filter((item) => item.kind === '日报').map((item) => item.date)))
          .catch(() => {})
        return () => {
          abortRef.current?.abort?.()
          if (stepTimer.current) clearInterval(stepTimer.current)
        }
      }, [])
      useEffect(() => {
        if (!popOpen) return undefined
        const close = (event) => {
          if (event.key === 'Escape') { setPopOpen(false); return }
          if (event.type === 'mousedown' && rangeRef.current && !rangeRef.current.contains(event.target)) setPopOpen(false)
        }
        document.addEventListener('keydown', close)
        document.addEventListener('mousedown', close)
        return () => { document.removeEventListener('keydown', close); document.removeEventListener('mousedown', close) }
      }, [popOpen])
      const applyNatural = (nextMode) => {
        const range = defaultSummaryRange(nextMode, anchor)
        setMode(nextMode); setStart(range.from); setEnd(range.to)
        setPopOpen(false); setDraft({ from: range.from, to: range.to })
        setInputStart(range.from); setInputEnd(range.to); setRangeError('')
      }
      const shift = (dir) => {
        if (natural) {
          const range = defaultSummaryRange(mode, dir > 0 ? shiftKey(end, 1) : shiftKey(start, -1))
          setStart(range.from); setEnd(range.to)
        } else {
          const delta = days * dir
          setStart(shiftKey(start, delta)); setEnd(shiftKey(end, delta))
        }
      }
      const openPicker = () => {
        setDraft({ from: start, to: end })
        setHover('')
        setViewMonth(start.slice(0, 7))
        setInputStart(start); setInputEnd(end)
        setRangeError('')
        setPopOpen(true)
      }
      const setDraftRange = (range) => {
        setDraft({ from: range.from, to: range.to })
        setInputStart(range.from); setInputEnd(range.to)
        setViewMonth(range.from.slice(0, 7))
        setHover('')
        const length = daysBetweenKeys(range.from, range.to)
        setRangeError(length > 93 ? '范围最长 93 天，请缩短' : '')
      }
      const typed = (nextStart, nextEnd) => {
        setInputStart(nextStart); setInputEnd(nextEnd)
        const validStart = validDateKey(nextStart)
        const validEnd = validDateKey(nextEnd)
        if (!nextStart || !nextEnd) { setRangeError(''); return }
        if (!validStart || !validEnd) { setRangeError('日期格式应为 2026-11-09'); return }
        if (nextEnd < nextStart) { setRangeError('结束日期不能早于开始日期'); return }
        const length = daysBetweenKeys(nextStart, nextEnd)
        if (length > 93) { setRangeError('范围最长 93 天，请缩短'); return }
        setDraft({ from: nextStart, to: nextEnd })
        setViewMonth(nextStart.slice(0, 7))
        setRangeError('')
      }
      const pickDay = (key) => {
        if (!draft.from || draft.to) {
          setDraft({ from: key, to: null }); setInputStart(key); setInputEnd(''); setHover('')
          setRangeError('')
          return
        }
        const from = key < draft.from ? key : draft.from
        const to = key < draft.from ? draft.from : key
        setDraftRange({ from, to })
      }
      const popStart = draft.from
      const popEnd = draft.to || hover
      const [rangeA, rangeB] = popStart && popEnd && popStart > popEnd ? [popEnd, popStart] : [popStart, popEnd]
      const monthTitle = (key) => {
        const d = dateOfKey(`${key}-01`)
        return d ? `${d.getFullYear()} 年 ${d.getMonth() + 1} 月` : ''
      }
      const renderMonth = (monthKey, first) => {
        const base = dateOfKey(`${monthKey}-01`)
        if (!base) return null
        const year = base.getFullYear(); const month = base.getMonth()
        const offset = (new Date(year, month, 1).getDay() + 6) % 7
        const total = new Date(year, month + 1, 0).getDate()
        const cells = []
        for (let i = 0; i < offset; i += 1) cells.push(null)
        for (let d = 1; d <= total; d += 1) cells.push(`${year}-${pad2(month + 1)}-${pad2(d)}`)
        return h('div', { className: 'wb-sum-mon', key: monthKey },
          h('div', { className: 'wb-sum-mt' },
            first ? h('button', { 'aria-label': '上个月', onClick: () => setViewMonth(shiftMonthKey(`${monthKey}-01`, -1).slice(0, 7)) }, '‹') : h('i'),
            h('span', null, `${year} 年 ${month + 1} 月`),
            first ? h('i') : h('button', { 'aria-label': '下个月', onClick: () => setViewMonth(shiftMonthKey(`${monthKey}-01`, 1).slice(0, 7)) }, '›')),
          h('div', { className: 'wb-sum-grid' },
            ['一', '二', '三', '四', '五', '六', '日'].map((w) => h('div', { key: w, className: 'wb-sum-wd' }, w)),
            cells.map((key, index) => {
              if (!key) return h('div', { key: `blank-${index}` })
              const inRange = Boolean(rangeA && rangeB && key >= rangeA && key <= rangeB)
              const isStart = Boolean(rangeA && rangeB && key === rangeA)
              const isEnd = Boolean(rangeA && rangeB && key === rangeB)
              const single = Boolean(popStart && !popEnd && key === popStart)
              return h('button', {
                key, type: 'button',
                className: `wb-sum-d${inRange ? ' in' : ''}${isStart || single ? ' s' : ''}${isEnd || single ? ' e' : ''}${key === today ? ' today' : ''}${key > today ? ' out' : ''}${reportSet.has(key) ? ' rep' : ''}`,
                'aria-label': rangeDateText(key),
                onMouseEnter: () => { if (draft.from && !draft.to) setHover(key) },
                onClick: () => pickDay(key),
              }, h('span', null, Number(key.slice(8))))
            })))
      }
      const startRun = async () => {
        if (off) { show(`AI 暂时不可用：${aiReasonOf(ai)}`, 'error'); return }
        if (!covered) { show('这个范围内没有日报，没法生成', 'error'); return }
        if (!audienceCount) { show('请至少选一位读者', 'error'); return }
        const keys = [...selectedAudiences]
        runSnapshot.current = { output, generated, edited, model, versions, currentVersion }
        setRunStep(0); setRunIndex(0); setRunKeys(keys)
        setVersions(null); setCurrentVersion('')
        if (stepTimer.current) clearInterval(stepTimer.current)
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
        abortRef.current = controller
        try {
          if (keys.length === 1) {
            stepTimer.current = setInterval(() => setRunStep((step) => (step === null ? null : Math.min(2, step + 1))), 700)
            const data = await request('/reports/summary/generate', {
              period: mode, date: anchor, custom: true, from: start, to: end, audience: keys[0],
            }, controller ? { signal: controller.signal } : undefined)
            if (stepTimer.current) clearInterval(stepTimer.current)
            setRunStep(null); setRunKeys([])
            setOutput(data.markdown ?? ''); setModel(data.model ?? '')
            setGenerated(true); setEdited(false)
            show('已生成草稿，请检查后保存')
          } else {
            const collected = []
            let lastModel = ''
            for (let index = 0; index < keys.length; index += 1) {
              setRunIndex(index)
              const data = await request('/reports/summary/generate', {
                period: mode, date: anchor, custom: true, from: start, to: end, audience: keys[index],
              }, controller ? { signal: controller.signal } : undefined)
              if (controller?.signal.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' })
              lastModel = data.model ?? lastModel
              collected.push({ key: `${index}-${keys[index]}`, audience: keys[index], content: data.markdown ?? '', aiGenerated: true })
            }
            setRunStep(null); setRunKeys([]); setRunIndex(0)
            setVersions(collected); setCurrentVersion(collected[0].key)
            setOutput(collected[0].content); setModel(lastModel)
            setGenerated(true); setEdited(false)
            show(`已生成 ${collected.length} 个版本，请逐个检查后保存`)
          }
          runSnapshot.current = null
        } catch (error) {
          if (stepTimer.current) clearInterval(stepTimer.current)
          const snapshot = runSnapshot.current
          setRunStep(null); setRunKeys([]); setRunIndex(0)
          if (snapshot) {
            setOutput(snapshot.output); setGenerated(snapshot.generated); setEdited(snapshot.edited)
            setModel(snapshot.model); setVersions(snapshot.versions); setCurrentVersion(snapshot.currentVersion ?? '')
          }
          runSnapshot.current = null
          if (error?.name === 'AbortError') show('已取消，原有内容未改动')
          else show(error.message, 'error')
        } finally { abortRef.current = null }
      }
      const cancelRun = () => {
        abortRef.current?.abort?.()
        if (stepTimer.current) clearInterval(stepTimer.current)
        setRunStep(null)
        setRunKeys([])
        setRunIndex(0)
      }
      const regenerateVersion = async () => {
        const item = currentVersionItem
        if (!item || off) return
        const snapshot = { versions: versions ? versions.map((value) => ({ ...value })) : null, currentVersion, model }
        setRunStep(0); setRunKeys([item.audience]); setRunIndex(0)
        if (stepTimer.current) clearInterval(stepTimer.current)
        stepTimer.current = setInterval(() => setRunStep((step) => (step === null ? null : Math.min(2, step + 1))), 700)
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
        abortRef.current = controller
        try {
          const data = await request('/reports/summary/generate', {
            period: mode, date: anchor, custom: true, from: start, to: end, audience: item.audience,
          }, controller ? { signal: controller.signal } : undefined)
          if (stepTimer.current) clearInterval(stepTimer.current)
          setRunStep(null); setRunKeys([])
          setVersions((current) => (current ?? []).map((value) => (value.key === item.key ? { ...value, content: data.markdown ?? '', aiGenerated: true } : value)))
          setModel(data.model ?? '')
          show(`已重新生成「${summaryAudienceShort(item.audience)}」`)
        } catch (error) {
          if (stepTimer.current) clearInterval(stepTimer.current)
          setRunStep(null); setRunKeys([])
          setVersions(snapshot.versions); setCurrentVersion(snapshot.currentVersion)
          if (snapshot.model) setModel(snapshot.model)
          if (error?.name === 'AbortError') show('已取消，原有内容未改动')
          else show(error.message, 'error')
        } finally { abortRef.current = null }
      }
      const save = async () => {
        const primary = primaryContent.trim()
        if (!primary) { show('内容为空', 'error'); return }
        const multi = versionList.length > 1
        try {
          await request('/reports/summary/save', {
            period: mode, date: anchor, custom: true, from: start, to: end, name: fileKey,
            markdown: primary,
            source: (multi ? versionList.some((item) => item.aiGenerated) : generated) ? 'AI' : '人工',
            ...((multi || generated) && model ? { model } : {}),
            versions: multi
              ? versionList.map(({ audience, content, aiGenerated }) => ({ audience, content, aiGenerated }))
              : [],
          })
          show(`已保存为「${displayName}」${multi ? `，含 ${versionList.length} 个版本` : ''}`)
          await onSaved?.()
          onClose()
        } catch (error) { show(error.message, 'error') }
      }
      const calIcon = h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
        h('rect', { x: 2, y: 3, width: 12, height: 11, rx: 2 }), h('path', { d: 'M2 6.5h12M5.5 1.5v3M10.5 1.5v3' }))
      const monthTwo = viewMonth ? shiftMonthKey(`${viewMonth}-01`, 1).slice(0, 7) : ''
      const selectedText = draft.from && draft.to
        ? `已选 ${daysBetweenKeys(draft.from < draft.to ? draft.from : draft.to, draft.to > draft.from ? draft.to : draft.from)} 天`
        : draft.from ? '再点一天作为结束日期' : '请选择开始日期'
      const rangePopover = h('div', { className: 'wb-sum-pop open', role: 'dialog', 'aria-label': '选择日期范围' },
        h('div', { className: 'wb-sum-pbody' },
          h('div', { className: 'wb-sum-presets' },
            h('h4', null, '快捷选择'),
            presets.map(([presetLabel, range]) => h('button', {
              key: presetLabel,
              className: draft.from === range.from && draft.to === range.to ? 'on' : '',
              onClick: () => setDraftRange(range),
            }, presetLabel))),
          h('div', { className: 'wb-sum-cal' },
            h('div', { className: 'wb-sum-inputs' },
              h('input', {
                'aria-label': '开始日期', placeholder: 'YYYY-MM-DD', value: inputStart,
                className: inputStart && !validDateKey(inputStart) ? 'bad' : '',
                onChange: (event) => typed(event.target.value, inputEnd),
              }),
              h('span', null, '→'),
              h('input', {
                'aria-label': '结束日期', placeholder: 'YYYY-MM-DD', value: inputEnd,
                className: inputEnd && (!validDateKey(inputEnd) || (validDateKey(inputStart) && inputEnd < inputStart)) ? 'bad' : '',
                onChange: (event) => typed(inputStart, event.target.value),
              })),
            h('p', { className: 'wb-sum-err' }, rangeError),
            h('div', { className: 'wb-sum-months' }, renderMonth(viewMonth, true), renderMonth(monthTwo, false)))),
        h('div', { className: 'wb-sum-pf' },
          h('span', { className: 'wb-sum-legend' }, h('i'), '当天已写日报 · ', h('span', null, selectedText)),
          h('span', { className: 'wb-sum-pbtns' },
            h('button', { className: 'wb-sum-btn', onClick: () => setPopOpen(false) }, '取消'),
            h('button', {
              className: 'wb-sum-btn wb-sum-btn-p',
              disabled: !draft.from || !draft.to || Boolean(rangeError),
              onClick: () => {
                if (!draft.from || !draft.to || rangeError) return
                const a = draft.from < draft.to ? draft.from : draft.to
                const b = draft.to > draft.from ? draft.to : draft.from
                setStart(a); setEnd(b); setPopOpen(false)
              },
            }, '应用范围'))))
      return h(Modal, {
        title: '生成周报 / 月报', onClose, size: 'xl', className: 'wb-summary-card',
        footer: [
          h('div', { key: 'name', className: 'wb-sum-nm' }, '保存为「', h('b', null, displayName), '」',
            versionList.length > 1 ? ` · 含 ${versionList.length} 个版本` : null),
          h('div', { key: 'btns', className: 'wb-sum-btns' },
            h('button', { className: 'wb-sum-btn', onClick: onClose }, '取消'),
            h('button', {
              className: 'wb-sum-btn wb-sum-btn-ai',
              disabled: off || runStep !== null || covered === 0 || audienceCount === 0,
              title: generateTitle,
              onClick: startRun,
            }, h(SparkIcon), generateLabel),
            h('button', { className: 'wb-sum-btn wb-sum-btn-p', disabled: runStep !== null || !primaryContent.trim(), onClick: save }, '保存')),
        ],
      },
        h('div', { className: 'wb-summary-body' },
          h('div', { className: 'wb-sum-seg', role: 'tablist' },
            h('button', { role: 'tab', 'aria-selected': mode === 'week', onClick: () => applyNatural('week') }, '周报'),
            h('button', { role: 'tab', 'aria-selected': mode === 'month', onClick: () => applyNatural('month') }, '月报')),
          h('div', null,
            h('label', { className: 'wb-sum-k' }, '汇总范围'),
            h('div', { className: 'wb-sum-range', ref: rangeRef },
              h('button', { className: 'wb-sum-step', 'aria-label': '上一个周期', title: `上一个${mode === 'week' ? '周' : '月'}`, onClick: () => shift(-1) }, '‹'),
              h('button', {
                className: 'wb-sum-trig', 'aria-haspopup': 'dialog', 'aria-expanded': popOpen,
                onClick: () => (popOpen ? setPopOpen(false) : openPicker()),
              },
                calIcon,
                h('span', { className: 'wb-sum-dt' }, h('small', null, '开始'), h('b', null, rangeDateText(start))),
                h('span', { className: 'wb-sum-arrow' }, '→'),
                h('span', { className: 'wb-sum-dt' }, h('small', null, '结束'), h('b', null, rangeDateText(end))),
                h('span', { className: 'wb-sum-len' }, `${days} 天`)),
              h('button', { className: 'wb-sum-step', 'aria-label': '下一个周期', title: `下一个${mode === 'week' ? '周' : '月'}`, onClick: () => shift(1) }, '›'),
              popOpen ? rangePopover : null),
            h('div', { className: 'wb-sum-meta' },
              natural
                ? h('span', null, `按${mode === 'week' ? '自然周' : '自然月'}汇总`)
                : h(React.Fragment, null,
                  h('span', { className: 'wb-sum-chip' }, '已自定义范围'),
                  h('button', {
                    className: 'wb-sum-link',
                    onClick: () => { const range = defaultSummaryRange(mode, anchor); setStart(range.from); setEnd(range.to) },
                  }, '恢复周期默认'))),
          ),
          h('div', { className: 'wb-sum-cov' },
            h('div', { className: 'wb-sum-cells', 'aria-hidden': true }, dayKeys.map((key) => h('i', {
              key, className: key > today ? 'fut' : reportSet.has(key) ? 'on' : '',
              title: `${rangeDateText(key)}${reportSet.has(key) ? ' · 已写日报' : key > today ? ' · 未到' : ''}`,
            }))),
            h('span', null, `${days} 天中有 ${covered} 天写了日报${covered === 0 ? '，AI 将无素材可用，建议改写范围或手写' : ''}`)),
          h('div', null,
            h('label', { className: 'wb-sum-k' }, '写给谁'),
            h('div', { className: 'wb-row', style: { gap: 8, alignItems: 'center' } },
              h('div', { className: 'wb-tags' },
                SUMMARY_AUDIENCES.map((item) => h('button', {
                  key: item.key, type: 'button',
                  className: `wb-chip${audiences[item.key] ? ' on' : ''}`,
                  'aria-pressed': Boolean(audiences[item.key]),
                  onClick: () => toggleAudience(item.key),
                }, item.label)),
                customAudienceOn
                  ? h('input', {
                    className: 'wb-input',
                    style: { width: 140, height: 24, padding: '0 8px', fontSize: 11 },
                    placeholder: '例如：客户', value: customAudience,
                    'aria-label': '其他读者',
                    onChange: (event) => setCustomAudience(event.target.value),
                  })
                  : h('button', { type: 'button', className: 'wb-chip', onClick: () => setCustomAudienceOn(true) }, '＋ 其他读者')),
              h('span', { className: 'wb-hint' }, audienceCount ? '可多选，一次生成多个版本' : '至少选一位读者才能生成'))),
          off ? h('div', { className: 'wb-sum-warn' },
            h('span', null, '✦'), h('span', null, 'AI 暂不可用：', aiReasonOf(ai), '。'),
            h('button', { className: 'wb-sum-link', onClick: () => show('正在重试连接模型…') }, '重试'),
            h('span', null, '·'), h('span', null, '也可以直接在下方手写，内容不会丢失')) : null,
          h('div', { className: 'wb-sum-res' },
            runStep !== null
              ? h('div', { className: 'wb-sum-run' },
                runKeys.length > 1
                  ? h(React.Fragment, null,
                    h('div', { className: 'wb-sum-st now' }, `✦ AI 正在生成 ${runKeys.length} 个版本 · 使用 ${modelShort}`),
                    runKeys.map((key, index) => h('div', {
                      key, className: `wb-sum-st${index < runIndex ? ' done' : index === runIndex ? ' now' : ''}`,
                    }, index < runIndex ? '✓' : index === runIndex ? h(Spinner) : '○', ' ', summaryAudienceShort(key))),
                    h('div', { className: 'wb-sum-pg' }, h('i', { style: { width: `${Math.round(((runIndex + 1) / runKeys.length) * 100)}%` } })),
                    h('div', null, h('button', { className: 'wb-sum-btn', onClick: cancelRun }, '取消生成')))
                  : h(React.Fragment, null,
                    h('div', { className: 'wb-sum-st now' }, `✦ AI 正在生成 · ${label} · 使用当前模型`),
                    ['读取日报', '归纳要点', '撰写汇总'].map((text, index) => h('div', {
                      key: text, className: `wb-sum-st${index < runStep ? ' done' : index === runStep ? ' now' : ''}`,
                    }, index < runStep ? '✓' : index === runStep ? h(Spinner) : '○', ' ', text)),
                    h('div', { className: 'wb-sum-pg' }, h('i', { style: { width: `${Math.min(96, (runStep + 1) * 33)}%` } })),
                    h('div', null, h('button', { className: 'wb-sum-btn', onClick: cancelRun }, '取消生成'))))
              : versionList.length > 1
                ? h(React.Fragment, null,
                  h('div', { className: 'wb-sum-rh' },
                    h('div', { className: 'wb-seg', role: 'tablist', 'aria-label': '版本' },
                      versionList.map((item) => h('button', {
                        key: item.key, type: 'button',
                        className: item.key === currentVersion ? 'on' : '',
                        title: item.audience,
                        onClick: () => setCurrentVersion(item.key),
                      }, summaryAudienceShort(item.audience)))),
                    h('span', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                      h('span', { className: 'wb-sum-tag', title: '由当前模型生成，可自由修改' }, '✦ AI 生成'),
                      h('button', {
                        className: 'wb-btn sm ghost', disabled: off,
                        title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : '重新生成此版本',
                        onClick: regenerateVersion,
                      }, '重新生成此版本'))),
                  h('div', { className: 'wb-sum-edit' },
                    h('textarea', {
                      className: 'wb-textarea', value: currentVersionItem?.content ?? '',
                      placeholder: '可以直接手写。', 'aria-label': '汇总内容编辑',
                      style: { height: '100%', minHeight: 0, resize: 'none' },
                      onChange: (event) => { if (currentVersionItem) updateVersionContent(currentVersionItem.key, event.target.value) },
                    }),
                    h('div', { className: 'wb-sum-prev', 'aria-label': '汇总内容预览' },
                      currentVersionItem?.content?.trim()
                        ? renderMarkdown(currentVersionItem.content)
                        : h('div', { className: 'wb-empty' }, '生成或输入后，这里显示预览。'))))
                : h(React.Fragment, null,
                  h('div', { className: 'wb-sum-rh' },
                    h('span', null, mode === 'week' ? '周报内容' : '月报内容'),
                    h('span', null, generated
                      ? h('span', { className: 'wb-sum-tag', title: '由当前模型生成，可自由修改' }, `✦ AI 生成${edited ? ' · 已编辑' : ''}`)
                      : '可直接手写')),
                  h('div', { className: 'wb-sum-edit' },
                    h('textarea', {
                      className: 'wb-textarea', value: output, 'aria-label': '汇总内容编辑',
                      style: { height: '100%', minHeight: 0, resize: 'none' },
                      placeholder: `点「生成${label}」让 AI 根据这段时间的日报起草；也可以直接手写。`,
                      onChange: (event) => {
                        setOutput(event.target.value)
                        if (generated) setEdited(true)
                      },
                    }),
                    h('div', { className: 'wb-sum-prev', 'aria-label': '汇总内容预览' },
                      output.trim()
                        ? renderMarkdown(output)
                        : h('div', { className: 'wb-empty' }, '生成或输入后，这里显示预览。')))))),
      )
    }

    function ReportsTab({ state, show }) {
      const [reports, setReports] = useState([])
      const [loading, setLoading] = useState(true)
      const [loadError, setLoadError] = useState('')
      const [sort, setSort] = useState('time')
      const [activeKind, setActiveKind] = useState('日报')
      const [active, setActive] = useState(null)
      const [content, setContent] = useState('')
      const [tags, setTags] = useState([])
      const [editing, setEditing] = useState(false)
      const [original, setOriginal] = useState('')
      const [confirmLeave, setConfirmLeave] = useState(false)
      const [sourceInfo, setSourceInfo] = useState({ source: null, model: null, updatedAt: null, mtime: 0 })
      const [detailError, setDetailError] = useState(null)
      const [mode, setMode] = useState('md')
      const [html, setHtml] = useState('')
      const [versions, setVersions] = useState([])
      const [versionIndex, setVersionIndex] = useState(0)
      const [goalSuggestions, setGoalSuggestions] = useState([])
      const [ignoredSuggestions, setIgnoredSuggestions] = useState(new Set())
      const [suggestOpen, setSuggestOpen] = useState(false)
      const [analysisOpen, setAnalysisOpen] = useState(false)
      const activeRef = useRef(null)
      const openSeq = useRef(0)
      useEffect(() => { activeRef.current = active }, [active])
      const [templateOpen, setTemplateOpen] = useState(false)
      const [summaryOpen, setSummaryOpen] = useState(false)
      const [summaryPeriod, setSummaryPeriod] = useState('week')
      const [plusOpen, setPlusOpen] = useState(false)
      const [exportOpen, setExportOpen] = useState(false)
      const [moreOpen, setMoreOpen] = useState(false)
      const plusRef = useRef(null)
      const moreRef = useRef(null)
      useDismiss(plusRef, () => setPlusOpen(false))
      useDismiss(moreRef, () => setMoreOpen(false))
      const [tagEditor, setTagEditor] = useState(false)
      const [removing, setRemoving] = useState(false)
      const [busy, setBusy] = useState('')
      const [listWidth, setListWidth] = useState(() => {
        const saved = Number(window.localStorage?.getItem('wb.reports.listWidth'))
        return Number.isFinite(saved) && saved >= 220 ? saved : 320
      })
      const widthRef = useRef(listWidth)
      useEffect(() => { widthRef.current = listWidth }, [listWidth])

      const load = useCallback(async () => {
        try {
          const data = await request('/reports')
          const list = data.reports ?? []
          setReports(list); setLoadError('')
          return list
        } catch (error) {
          setLoadError(error.message)
          show('日报列表没加载出来，请重试', 'error')
          return []
        } finally { setLoading(false) }
      }, [show])

      const open = useCallback(async (date) => {
        try {
          const data = await request(`/report?date=${date}`)
          const seq = ++openSeq.current
          setActiveKind('日报'); setActive(date); setContent(data.markdown ?? ''); setTags(data.tags ?? [])
          setVersions([]); setVersionIndex(0)
          setGoalSuggestions([]); setIgnoredSuggestions(new Set()); setSuggestOpen(false); setAnalysisOpen(false)
          setSourceInfo({ source: data.source ?? null, model: data.model ?? null, updatedAt: data.updatedAt ?? null, mtime: data.mtime ?? 0 })
          setDetailError(null); setEditing(false); setOriginal(data.markdown ?? ''); setMode('md'); setHtml('')
          if (data.markdown?.trim()) {
            request('/report/goal-suggestions', { markdown: data.markdown })
              .then((result) => { if (openSeq.current === seq) setGoalSuggestions(result.suggestions ?? []) })
              .catch(() => {})
          }
        } catch (error) {
          setDetailError({ kind: '日报', message: error.message })
          show('这份日报暂时打不开，请重试', 'error')
        }
      }, [show])

      const openSummary = useCallback(async (name, kind) => {
        try {
          const data = await request(`/reports/summary/read?name=${encodeURIComponent(name)}`)
          const list = Array.isArray(data.versions) ? data.versions : []
          const first = list.length ? list[0].content : (data.markdown ?? '')
          openSeq.current += 1
          setActiveKind(kind); setActive(name); setContent(first); setTags(data.tags ?? [])
          setVersions(list); setVersionIndex(0)
          setGoalSuggestions([]); setIgnoredSuggestions(new Set()); setSuggestOpen(false); setAnalysisOpen(false)
          setSourceInfo({ source: data.source ?? null, model: data.model ?? null, updatedAt: data.updatedAt ?? null, mtime: data.mtime ?? 0 })
          setDetailError(null); setEditing(false); setOriginal(first); setMode('md'); setHtml('')
        } catch (error) {
          setDetailError({ kind: kind || '汇总', message: error.message })
          show(`这份${kind || '汇总'}暂时打不开，请重试`, 'error')
        }
      }, [show])

      const switchVersion = (index) => {
        if (editing) return
        const item = versions[index]
        if (!item) return
        setVersionIndex(index); setContent(item.content); setOriginal(item.content); setMode('md'); setHtml('')
      }

      useEffect(() => {
        void load().then((list) => {
          if (!list.length) return
          const first = list[0]
          if (first.kind === '日报') void open(first.date)
          else void openSummary(first.name, first.kind)
        })
      }, [load, open, openSummary])

      useEffect(() => {
        if (!exportOpen) return undefined
        const close = (event) => {
          const target = event.target instanceof Element ? event.target : null
          if (target?.closest('.wb-export')) return
          setExportOpen(false)
        }
        const timer = setTimeout(() => document.addEventListener('pointerdown', close, true), 0)
        return () => { clearTimeout(timer); document.removeEventListener('pointerdown', close, true) }
      }, [exportOpen])

      const startDrag = (event) => {
        event.preventDefault()
        const startX = event.clientX
        const startWidth = widthRef.current
        let frame = 0
        let latest = startWidth
        document.body.classList.add('wb-dragging')
        const onMove = (moveEvent) => {
          latest = Math.max(220, Math.min(560, startWidth + moveEvent.clientX - startX))
          if (!frame) frame = requestAnimationFrame(() => {
            frame = 0
            setListWidth(latest)
            try { window.localStorage?.setItem('wb.reports.listWidth', String(latest)) } catch { /* 忽略 */ }
          })
        }
        const onUp = () => {
          if (frame) cancelAnimationFrame(frame)
          document.body.classList.remove('wb-dragging')
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
      }

      const buildPage = async () => {
        const tagTitles = tags.map((tag) => tag.title)
        if (activeKind !== '日报') {
          if (!editing) {
            if (html) return html
            const versionQuery = versions.length > 1 ? `&version=${versionIndex}` : ''
            const data = await request(`/reports/summary/html?name=${encodeURIComponent(active)}${versionQuery}`)
            setHtml(data.html ?? '')
            return data.html ?? ''
          }
          const template = await request('/report/template')
          return fillTemplate(template.template, { markdown: content, date: active, tags: tagTitles })
        }
        if (!editing) {
          if (html) return html
          const data = await request(`/report/html?date=${active}`)
          setHtml(data.html ?? '')
          return data.html ?? ''
        }
        const template = await request('/report/template')
        return fillTemplate(template.template, { markdown: content, date: active, tags: tagTitles })
      }
      const renderHtml = async () => {
        if (mode === 'html') { setMode('md'); return }
        try { const page = await buildPage(); if (!editing) setHtml(page); setMode('html') }
        catch (error) { show(error.message, 'error') }
      }
      const copy = async () => {
        try {
          const page = await buildPage()
          const ok = await copyRich(page, content)
          show(ok ? '已复制（富文本 + 纯文本），可直接粘贴到飞书 / 微信' : '复制失败', ok ? 'ok' : 'error')
        } catch (error) { show(error.message, 'error') }
      }
      const exportPdf = async () => {
        setExportOpen(false); setBusy('pdf')
        try { const page = await buildPage(); printHtml(page); show('已打开打印窗口，选择「另存为 PDF」') }
        catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const exportImage = async () => {
        setExportOpen(false); setBusy('png')
        try { const page = await buildPage(); await exportPng(page, `${active}-工作日报.png`); show('已导出 PNG 图片') }
        catch (error) { show(`导出图片失败：${error.message}`, 'error') } finally { setBusy('') }
      }
      const exportHtml = async () => {
        setExportOpen(false); setBusy('html')
        try {
          const page = await buildPage()
          downloadBlob(`${active}-工作日报.html`, new Blob([page], { type: 'text/html;charset=utf-8' }))
          show('已导出 HTML')
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const reloadActive = async () => {
        if (!active) return
        if (activeKind === '日报') await open(active)
        else await openSummary(active, activeKind)
      }
      const startEdit = () => { setOriginal(content); setEditing(true); setMode('md') }
      const cancelEdit = () => {
        if (content !== original) { setConfirmLeave(true); return }
        setEditing(false)
        void reloadActive()
      }
      const save = async () => {
        if (!content.trim()) { show('内容为空', 'error'); return }
        setBusy('save')
        const multi = activeKind !== '日报' && versions.length > 1
        try {
          if (activeKind === '日报') {
            const data = await request('/save-report', { date: active, markdown: content, goalIds: tags.map((tag) => tag.id) })
            setTags(data.tags ?? tags)
          } else if (multi) {
            const nextVersions = versions.map((item, index) => (index === versionIndex ? { ...item, content } : item))
            await request('/reports/summary/save', {
              name: active,
              markdown: nextVersions[0].content,
              versions: nextVersions.map(({ audience, content: value, aiGenerated }) => ({ audience, content: value, aiGenerated })),
            })
            setVersions(nextVersions)
            setOriginal(content)
            setSourceInfo((current) => ({ ...current, updatedAt: new Date().toISOString(), mtime: Date.now() }))
          } else {
            await request('/reports/summary/update', { name: active, markdown: content })
          }
          await load(); setEditing(false); setHtml(''); setMode('md')
          if (!multi) await reloadActive()
          show(activeKind === '日报' ? '已保存，日报已更新' : '已保存，汇总已更新')
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const removeReport = async () => {
        const snapshot = {
          kind: activeKind, key: active, markdown: content, tags: [...tags], source: sourceInfo.source, model: sourceInfo.model,
          versions: versions.map((item) => ({ ...item })),
        }
        setBusy('delete')
        try {
          if (activeKind === '日报') await request('/report/delete', { date: active })
          else await request('/reports/summary/delete', { name: active })
          setRemoving(false); setActive(null); setContent(''); setTags([]); setVersions([]); setVersionIndex(0); setSourceInfo({ source: null, model: null, updatedAt: null, mtime: 0 })
          const list = await load()
          if (list.length) {
            const first = list[0]
            if (first.kind === '日报') await open(first.date)
            else await openSummary(first.name, first.kind)
          }
          show(`已删除这份${snapshot.kind}，6 秒内可撤销`, 'ok', async () => {
            try {
              const source = snapshot.source === 'AI' ? 'AI' : snapshot.source === '人工' ? '人工' : undefined
              if (snapshot.kind === '日报') {
                await request('/save-report', {
                  date: snapshot.key, markdown: snapshot.markdown,
                  goalIds: snapshot.tags.map((tag) => tag.id),
                  ...(source ? { source } : {}),
                  ...(snapshot.model ? { model: snapshot.model } : {}),
                })
              } else {
                await request('/reports/summary/save', {
                  name: snapshot.key, markdown: snapshot.markdown,
                  ...(snapshot.versions?.length ? { versions: snapshot.versions } : {}),
                  ...(source ? { source } : {}),
                  ...(snapshot.model ? { model: snapshot.model } : {}),
                })
              }
              const restored = await load()
              if (snapshot.kind === '日报') await open(snapshot.key)
              else await openSummary(snapshot.key, snapshot.kind)
              show('已撤销删除', 'ok')
              return restored
            } catch (error) { show(error.message, 'error') }
          })
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const tagChips = (list, onRemove) => h('div', { className: 'wb-tags' },
        list.map((tag) => h('span', { key: tag.id, className: 'wb-tag' }, `${tag.cycle} · ${tag.title}`,
          onRemove ? h('button', { onClick: () => onRemove(tag.id), title: '移除' }, '×') : null)),
      )
      const openGoalSuggestions = goalSuggestions.filter((item) => !ignoredSuggestions.has(item.goalId) && !tags.some((tag) => tag.id === item.goalId))
      useEffect(() => {
        if (!openGoalSuggestions.length) setSuggestOpen(false)
      }, [openGoalSuggestions.length])
      const ignoreGoalSuggestion = (item) => {
        setIgnoredSuggestions((current) => new Set(current).add(item.goalId))
      }
      const associateGoalSuggestion = async (item) => {
        const previousIds = tags.map((tag) => tag.id)
        try {
          const data = await request('/report/tags', { date: active, goalIds: [...new Set([...previousIds, item.goalId])] })
          setTags(data.tags ?? [])
          setSuggestOpen(false)
          await load()
          const targetDate = active
          show(`已关联 ${item.goalTitle}`, 'ok', async () => {
            try {
              const back = await request('/report/tags', { date: targetDate, goalIds: previousIds })
              if (activeRef.current === targetDate) setTags(back.tags ?? [])
              await load()
              show('已撤销关联')
            } catch (error) { show(error.message, 'error') }
          })
        } catch (error) { show(error.message, 'error') }
      }
      const ignoreAllGoalSuggestions = () => {
        if (!openGoalSuggestions.length) return
        const count = openGoalSuggestions.length
        setIgnoredSuggestions((current) => {
          const next = new Set(current)
          openGoalSuggestions.forEach((item) => next.add(item.goalId))
          return next
        })
        setSuggestOpen(false)
        show(`已忽略 ${count} 条关联建议`)
      }
      const associateAllGoalSuggestions = async () => {
        const pending = openGoalSuggestions
        if (!pending.length) return
        const previousIds = tags.map((tag) => tag.id)
        const nextIds = [...new Set([...previousIds, ...pending.map((item) => item.goalId)])]
        setBusy('suggest')
        try {
          const data = await request('/report/tags', { date: active, goalIds: nextIds })
          setTags(data.tags ?? [])
          setSuggestOpen(false)
          await load()
          const targetDate = active
          show(`已关联 ${pending.length} 个目标`, 'ok', async () => {
            try {
              const back = await request('/report/tags', { date: targetDate, goalIds: previousIds })
              if (activeRef.current === targetDate) setTags(back.tags ?? [])
              await load()
              show('已撤销关联')
            } catch (error) { show(error.message, 'error') }
          })
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const suggestionCycles = Object.entries(openGoalSuggestions.reduce((acc, item) => {
        acc[item.cycle] = (acc[item.cycle] ?? 0) + 1
        return acc
      }, {})).map(([cycle, count]) => `${cycle} ${count}`).join(' · ')
      const goalSuggestionAnalysis = analysisOpen
        ? h('div', { className: 'wb-goal-sug-analysis' },
          h('div', { className: 'wb-small' },
            `日报里有 ${openGoalSuggestions.length} 个目标的可核对依据${suggestionCycles ? `（${suggestionCycles}）` : ''}；每条依据的关键词和原句都能在原文里逐字找到。`),
          openGoalSuggestions.map((item) => h('div', { key: item.goalId, className: 'wb-goal-sug-why' },
            h('span', { className: `wb-cycle-badge ${item.cycle}` }, item.cycle),
            h('span', { style: { flex: 1, minWidth: 0 } }, item.reason || `日报里出现了关键词「${item.keyword}」`),
            h('span', { className: 'wb-sugtag-lv' }, `把握${item.confidence}`))))
        : null
      const goalSuggestionItems = openGoalSuggestions.map((item) => h('div', { key: item.goalId, className: 'wb-goal-sug-item' },
        h('div', { className: 'wb-row', style: { gap: 6, alignItems: 'center' } },
          h('span', { className: `wb-cycle-badge ${item.cycle}` }, item.cycle),
          h('b', { className: 'wb-small', style: { flex: 1, minWidth: 0 } }, item.goalTitle),
          h('span', { className: 'wb-sugtag-lv' }, `把握${item.confidence}`)),
        h('div', { className: 'wb-evquote' }, highlightKeyword(item.quote, item.keyword)),
        h('div', { className: 'wb-row end' },
          h('button', { className: 'wb-btn sm ghost', onClick: () => ignoreGoalSuggestion(item) }, '忽略'),
          h('button', { className: 'wb-btn primary sm', disabled: busy === 'suggest', onClick: () => associateGoalSuggestion(item) }, '关联'))))
      const goalSuggestionPanel = suggestOpen && activeKind === '日报' && openGoalSuggestions.length
        ? h('div', { className: 'wb-goal-sug', id: 'wb-goal-suggest' },
          h('div', { className: 'wb-goal-sug-head' },
            h('span', { className: 'wb-ai-tag' }, '✦ AI 建议关联'),
            h('span', { className: 'wb-hint' }, `匹配到 ${openGoalSuggestions.length} 个目标`),
            h('div', { className: 'wb-spacer' }),
            h('button', { className: 'wb-icon-btn', 'aria-label': '关闭建议', title: '关闭', onClick: () => setSuggestOpen(false) }, '×')),
          goalSuggestionAnalysis,
          h('div', { className: 'wb-goal-sug-list' }, goalSuggestionItems),
          h('div', { className: 'wb-goal-sug-foot' },
            h('button', {
              className: 'wb-btn sm ghost', 'aria-expanded': analysisOpen,
              onClick: () => setAnalysisOpen(!analysisOpen),
            }, analysisOpen ? '收起分析' : '关联目标分析'),
            h('button', { className: 'wb-btn sm ghost', onClick: ignoreAllGoalSuggestions }, '忽略全部'),
            h('div', { className: 'wb-spacer' }),
            h('button', {
              className: 'wb-btn primary sm', disabled: busy === 'suggest',
              onClick: associateAllGoalSuggestions,
            }, busy === 'suggest' ? '关联中…' : `一键全部关联（${openGoalSuggestions.length}）`)))
        : null
      const goalSuggestionButton = activeKind === '日报' && !aiOffOf(state?.ai) && openGoalSuggestions.length
        ? h('button', {
          className: 'wb-btn ai-2 sm', 'aria-expanded': suggestOpen, 'aria-controls': 'wb-goal-suggest',
          onClick: () => setSuggestOpen(!suggestOpen),
        }, h(SparkIcon), `建议再关联 ${openGoalSuggestions.length} 个目标`, h('span', { className: 'wb-goal-sug-caret' }, suggestOpen ? '▴' : '▾'))
        : null

      const shortModel = String(sourceInfo.model ?? '').split('/').pop()
      const sourceLabel = sourceInfo.source === 'AI'
        ? `AI · ${shortModel || '模型'}`
        : sourceInfo.source === '人工' ? '手写' : activeKind === '日报' ? '日报文件' : '汇总文件'
      const modified = sourceInfo.updatedAt
        ? formatLocalStamp(sourceInfo.updatedAt)
        : sourceInfo.mtime ? formatLocalStamp(new Date(sourceInfo.mtime).toISOString()) : '—'
      const activeLabel = active ? `${activeKind} · ${active}` : '预览'
      return h(React.Fragment, null,
        h('div', { className: `wb-reports2${mode === 'html' ? ' wb-reports-html' : ''}`, style: { gridTemplateColumns: `${listWidth}px 8px minmax(0,1fr)` } },
          h('div', { className: 'wb-card' },
            h('div', { className: 'wb-card-head' },
              h('div', { className: 'wb-card-title' }, '列表'),
              h('span', { className: 'wb-badge' }, `${reports.length} 份`),
              h('div', { className: 'wb-spacer' }),
              h('div', { className: 'wb-seg', role: 'group', 'aria-label': '排序' },
                h('button', { className: sort === 'time' ? 'on' : '', onClick: () => setSort('time') }, '按时间'),
                h('button', { className: sort === 'group' ? 'on' : '', onClick: () => setSort('group') }, '按分组'))),
            h('div', { className: 'wb-rel', ref: plusRef, style: { marginBottom: 8 } },
              h('button', {
                className: 'wb-btn ai-2 sm', style: { width: '100%' }, 'aria-haspopup': 'menu', 'aria-expanded': plusOpen,
                onClick: () => setPlusOpen(!plusOpen),
              }, h(SparkIcon), '生成汇总 ▾'),
              plusOpen ? h('div', { className: 'wb-export', style: { left: 0, right: 0, top: 36 } },
                h('button', {
                  style: { color: 'var(--wb-ai)', display: 'flex', alignItems: 'center', gap: 6 },
                  onClick: () => { setSummaryPeriod('week'); setPlusOpen(false); setSummaryOpen(true) },
                }, h(SparkIcon), '生成周报'),
                h('button', {
                  style: { color: 'var(--wb-ai)', display: 'flex', alignItems: 'center', gap: 6 },
                  onClick: () => { setSummaryPeriod('month'); setPlusOpen(false); setSummaryOpen(true) },
                }, h(SparkIcon), '生成月报')) : null),
            loading
              ? h('div', { className: 'wb-card', style: { boxShadow: 'none', border: 0, padding: 0 } }, h(Skeleton, { rows: 5 }))
              : loadError
                ? h('div', { className: 'wb-empty-state' },
                  h('b', null, '日报列表没加载出来'),
                  h('div', { className: 'wb-small' }, '可能是插件服务刚重启。'),
                  h('button', { className: 'wb-btn primary sm', onClick: () => { setLoading(true); void load() } }, '重试'))
                : reports.length
              ? h('div', { className: 'wb-report-list' },
                (() => {
                  const ordered = sort === 'group'
                    ? ['日报', '周报', '月报', '汇总'].flatMap((kind) => reports.filter((item) => item.kind === kind))
                    : reports
                  return ordered.map((item, index) => {
                    const isSummary = item.kind !== '日报'
                    const showGroup = sort === 'group' && (index === 0 || ordered[index - 1].kind !== item.kind)
                    return h(React.Fragment, { key: `${item.kind}-${item.name}` },
                      showGroup ? h('div', { className: 'wb-list-group' }, item.kind) : null,
                      h('button', {
                        className: `wb-doc${active === item.name ? ' active' : ''}`,
                        onClick: () => (isSummary ? openSummary(item.name, item.kind) : open(item.date)),
                      },
                        h('div', { className: 'wb-doc-meta' },
                          h('span', { className: 'wb-badge' }, item.kind),
                          h('b', { style: { fontWeight: 600 } }, item.kind === '日报'
                            ? (item.name ?? item.dateLabel)
                            : `${item.name}${item.dateLabel && item.dateLabel !== item.name ? ` · ${item.dateLabel}` : ''}`),
                          item.source === 'AI' ? h('div', { className: 'wb-spacer' }) : null,
                          item.source === 'AI' ? h(AiTag, { model: item.model }) : null),
                        h('div', { className: 'wb-doc-title' }, item.title ?? item.name),
                        item.summary ? h('div', { className: 'wb-small wb-muted', style: { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, item.summary) : null,
                        (item.goalTags ?? []).length
                          ? h('div', { className: 'wb-doc-tags' }, (item.goalTags ?? []).slice(0, 3).map((tag) => h('span', { key: tag.id, className: 'wb-tag' }, `${tag.cycle} · ${tag.title}`)))
                          : null,
                      ))
                  })
                })(),
              )
              : h(EmptyState, { title: '还没有日报', text: '在今日页点日历里的一天，或新建今天日报，开始记录。' }),
          ),
          h('div', { className: 'wb-split', title: '拖动调整宽度', onMouseDown: startDrag }),
          h('div', { className: `wb-card${mode === 'html' ? ' wb-report-detail-html' : ''}` },
            detailError
              ? h('div', { className: 'wb-empty-state' },
                h('b', null, `这份${detailError.kind}暂时打不开`),
                h('div', { className: 'wb-small' }, '内容没有丢失，可以重试。'),
                h('button', {
                  className: 'wb-btn primary sm', onClick: () => {
                    setDetailError(null)
                    if (active) void reloadActive(); else void load()
                  },
                }, '重试'))
              : !active
                ? h('div', { className: 'wb-empty' }, '左侧选一份日报查看；支持编辑、复制、导出、删除。')
                : editing
                  ? h(React.Fragment, null,
                    h('div', { className: 'wb-editbar', role: 'status' },
                      h('b', null, `编辑中 · ${activeKind} ${active}${versions.length > 1 && versions[versionIndex] ? ` · ${summaryAudienceShort(versions[versionIndex].audience)}` : ''}`),
                      h('div', { className: 'wb-spacer' }),
                      h('button', { className: 'wb-btn sm', onClick: cancelEdit }, '取消'),
                      h('button', { className: 'wb-btn sm primary', disabled: busy === 'save', onClick: save }, busy === 'save' ? '保存中…' : '保存')),
                    h('div', { className: 'wb-edit-split' },
                      h('textarea', {
                        className: 'wb-textarea', value: content, 'aria-label': 'Markdown 编辑',
                        onChange: (event) => setContent(event.target.value),
                      }),
                      h('div', { className: 'wb-preview-pane' }, renderMarkdown(content))),
                    h('div', { className: 'wb-hint' }, '左边编辑，右边实时预览。'))
                  : h(React.Fragment, null,
                    h('div', { className: 'wb-toolbar' },
                      h('div', { style: { flex: '1 1 220px', minWidth: 0 } },
                        h('div', { className: 'wb-card-title' }, activeLabel),
                        h('div', { className: 'wb-row', style: { gap: 6, marginTop: 2, fontSize: 11, color: 'var(--wb-text-3)' } },
                          sourceInfo.source === 'AI' ? h(AiTag, { model: sourceInfo.model }) : null,
                          h('span', null, sourceInfo.source === 'AI'
                            ? `由 ${shortModel || 'AI'} 根据当天素材生成`
                            : `来源：${sourceLabel}`),
                          h('span', null, `· 最后修改 ${modified}`))),
                      h('button', { className: 'wb-btn sm primary', onClick: startEdit }, h(EditIcon), '编辑'),
                      h('button', { className: 'wb-btn sm ghost', onClick: copy }, '一键复制'),
                      h('div', { className: 'wb-rel' },
                        h('button', { className: 'wb-btn sm ghost', onClick: () => setExportOpen(!exportOpen) }, busy ? '导出中…' : '导出 ▾'),
                        exportOpen ? h('div', { className: 'wb-export' },
                          h('button', { onClick: exportPdf }, '导出 PDF'),
                          h('button', { onClick: exportImage }, '导出图片（PNG）'),
                          h('button', { onClick: exportHtml }, '导出 HTML')) : null),
                      h('div', { className: 'wb-rel', ref: moreRef },
                        h('button', { className: 'wb-icon-btn', title: '更多操作', 'aria-label': '更多操作', onClick: () => setMoreOpen(!moreOpen) }, '⋯'),
                        moreOpen ? h('div', { className: 'wb-export' },
                          h('button', { onClick: () => { setMoreOpen(false); setTemplateOpen(true) } }, '模板'),
                          h('button', { onClick: () => { setMoreOpen(false); renderHtml() } }, mode === 'html' ? 'Markdown 预览' : 'HTML 预览'),
                          h('button', { style: { color: 'var(--wb-danger)' }, onClick: () => { setMoreOpen(false); setRemoving(true) } }, `删除这份${activeKind}`)) : null)),
                    activeKind !== '日报' && versions.length > 1
                      ? h('div', { className: 'wb-row', style: { marginTop: 2 } },
                        h('div', { className: 'wb-seg', role: 'tablist', 'aria-label': '版本' },
                          versions.map((item, index) => h('button', {
                            key: `${index}-${item.audience}`,
                            type: 'button',
                            className: index === versionIndex ? 'on' : '',
                            title: item.audience,
                            onClick: () => switchVersion(index),
                          }, summaryAudienceShort(item.audience)))),
                        h('span', { className: 'wb-hint' }, `含 ${versions.length} 个版本`))
                      : null,
                    h('div', { className: 'wb-row', style: { marginTop: 2 } },
                      activeKind === '日报' ? tagChips(tags, async (id) => {
                        try {
                          const data = await request('/report/tags', { date: active, goalIds: tags.filter((tag) => tag.id !== id).map((tag) => tag.id) })
                          setTags(data.tags ?? [])
                          await load()
                          show('已移除关联目标')
                        } catch (error) { show(error.message, 'error') }
                      }) : h('div', { className: 'wb-tags' }, tags.map((tag) => h('span', { key: tag.id, className: 'wb-tag' }, `${tag.cycle} · ${tag.title}`))),
                      activeKind === '日报' ? h('button', { className: 'wb-btn sm ghost', onClick: () => setTagEditor(true) }, '＋ 关联目标') : null,
                      goalSuggestionButton),
                    goalSuggestionPanel,
                    mode === 'html'
                      ? h('iframe', { className: 'wb-iframe wb-iframe-fill', sandbox: '', srcDoc: html, title: '日报 HTML 预览' })
                      : content ? renderMarkdown(content) : h('div', { className: 'wb-empty' }, '这一天没有内容。')),
          ),
        ),
        templateOpen ? h(TemplateModal, { date: active, markdown: content, onClose: () => setTemplateOpen(false), show, ai: state.ai }) : null,
        summaryOpen ? h(SummaryModal, {
          date: state.date, initialPeriod: summaryPeriod, ai: state.ai,
          onClose: () => setSummaryOpen(false),
          onSaved: async () => { await load() },
          show,
        }) : null,
        tagEditor ? h(GoalTagEditor, { date: active, tags, onClose: () => setTagEditor(false), onSaved: async () => {
          const data = await request(`/report?date=${active}`)
          setTags(data.tags ?? [])
          await load()
        }, show, ai: state.ai }) : null,
        removing ? h(ConfirmModal, {
          title: `删除这份${activeKind}`,
          message: `确定删除 ${active} 的${activeKind}？文件会移除，且不可恢复。`,
          busy: busy === 'delete', onCancel: () => setRemoving(false), onConfirm: removeReport,
        }) : null,
        confirmLeave ? h(ConfirmModal, {
          title: '放弃修改？', message: `这份${activeKind}的修改还没保存，放弃后无法找回。`, confirmText: '放弃修改',
          onCancel: () => setConfirmLeave(false),
          onConfirm: () => { setConfirmLeave(false); setEditing(false); void reloadActive() },
        }) : null,
      )
    }

    function RelatedReportsModal({ goal, onClose, show }) {
      const [items, setItems] = useState(null)
      useEffect(() => {
        request(`/goals/related?goalId=${encodeURIComponent(goal.id)}`)
          .then((data) => setItems(data.items ?? []))
          .catch((error) => { show(error.message, 'error'); setItems([]) })
      }, [goal.id, show])
      return h(Modal, { title: `「${goal.title}」关联日报`, wide: true, onClose },
        items === null ? h('div', { className: 'wb-empty' }, '加载中…')
          : items.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '62vh', overflow: 'auto' } },
              items.map((item) => h('div', { key: `${item.kind}-${item.date}`, className: 'wb-card', style: { padding: '10px 12px' } },
                h('div', { className: 'wb-row' },
                  h('span', { className: 'wb-badge' }, item.kind),
                  h('strong', { style: { fontSize: 12 } }, item.dateLabel),
                  h('div', { className: 'wb-spacer' }),
                  item.tagged ? h('span', { className: 'wb-small wb-muted' }, '日报已标记关联') : null,
                ),
                (item.matched ?? []).length
                  ? h('ul', { style: { margin: '6px 0 0', paddingLeft: 18, fontSize: 12 } }, item.matched.map((line, index) => h('li', { key: index }, line)))
                  : h('div', { className: 'wb-small wb-muted' }, '日报里没有匹配到具体内容'),
              )))
            : h('div', { className: 'wb-empty-state' },
              h('b', null, '还没有关联的日报'),
              h('div', { className: 'wb-small' }, '在日报里给这份目标打个标签，这里就会出现。'),
              h('button', {
                className: 'wb-btn sm',
                onClick: () => { onClose(); window.dispatchEvent(new CustomEvent('zhixing:goto', { detail: { tab: 'reports' } })) },
              }, '去日报页关联')),
      )
    }

    function useDismiss(ref, onClose) {
      useEffect(() => {
        const onPointer = (event) => { if (ref.current && !ref.current.contains(event.target)) onClose() }
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        document.addEventListener('mousedown', onPointer)
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey) }
      }, [ref, onClose])
    }

    function GoalMenu({ items }) {
      const [open, setOpen] = useState(false)
      const ref = useRef(null)
      useDismiss(ref, () => setOpen(false))
      return h('div', { className: 'wb-rel', ref },
        h('button', { className: 'wb-btn ghost', title: '更多操作', onClick: () => setOpen(!open) }, '⋯'),
        open ? h('div', { className: 'wb-export', onMouseLeave: () => setOpen(false) },
          items.map((item) => h('button', {
            key: item.label,
            style: item.danger ? { color: 'var(--wb-danger)' } : item.ai ? { color: 'var(--wb-ai)' } : null,
            onClick: () => { setOpen(false); item.onClick() },
          }, item.ai ? h(SparkIcon, { size: 12 }) : null, item.label))) : null,
      )
    }

    function ProgressModal({ goal, initialTab = 'manual', ai, onClose, onApplied, show }) {
      const [tab, setTab] = useState(initialTab === 'ai' ? 'ai' : 'manual')
      const [value, setValue] = useState(String(goal.progress))
      const [reason, setReason] = useState('')
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [phase, setPhase] = useState('idle')
      const [suggestions, setSuggestions] = useState([])
      const [selected, setSelected] = useState(new Set())
      const off = aiOffOf(ai)
      const submit = async () => {
        const numeric = Number(value)
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) { setError('请输入 0–100 之间的数字'); return }
        setBusy('save')
        try {
          await request('/goals/progress', { id: goal.id, progress: Math.round(numeric), reason: reason.trim() || '手动更新' })
          await onApplied?.()
          show(`进度已更新为 ${Math.round(numeric)}%`)
          onClose()
        } catch (err) { setError(err.message) } finally { setBusy('') }
      }
      const evaluate = async () => {
        if (off) { show(`AI 暂时不可用：${aiReasonOf(ai)}`, 'error'); return }
        setPhase('running'); setSuggestions([]); setError('')
        try {
          const data = await request('/goals/ai-progress', { goalId: goal.id, preview: true })
          const list = (data.suggestions ?? []).map((item) => ({ ...item, checked: true }))
          setSuggestions(list)
          setSelected(new Set(list.map((_, index) => index)))
          setPhase('done')
          if (!list.length) show('AI 没有找到可更新的进度')
        } catch (err) { setPhase('idle'); show(err.message, 'error') }
      }
      const applyAi = async () => {
        const picked = suggestions.filter((_, index) => selected.has(index))
        if (!picked.length) return
        setBusy('apply')
        try {
          for (const item of picked) {
            await request('/goals/progress', {
              id: item.id,
              progress: item.to,
              reason: `采纳 AI 评估：${item.reason || '根据关联日报'}`,
            })
          }
          await onApplied?.()
          show(`已采纳 ${picked.length} 个进度建议`)
          onClose()
        } catch (err) { show(err.message, 'error') } finally { setBusy('') }
      }
      const manualBody = h(React.Fragment, null,
        h('div', { className: 'wb-form-field' }, '进度',
          h('div', { className: 'wb-row' },
            h('input', {
              className: 'wb-slider', type: 'range', min: 0, max: 100, value,
              onChange: (event) => { setValue(event.target.value); setError('') },
              style: { flex: '1 1 auto' },
            }),
            h('input', {
              className: 'wb-input', type: 'number', min: 0, max: 100, value,
              style: { width: 76 }, 'aria-label': '进度数值',
              onChange: (event) => { setValue(event.target.value); setError('') },
            }),
            h('span', { className: 'wb-small wb-muted' }, '%'))),
        h('label', { className: 'wb-form-field' }, '原因（可选）',
          h('input', { className: 'wb-input', value: reason, placeholder: '例如：完成登录灰度 60%', onChange: (event) => setReason(event.target.value) })),
        error ? h('div', { className: 'wb-field-error' }, error) : null)
      const aiBody = phase === 'running'
        ? h('div', { className: 'wb-ai-panel' },
          h('div', { className: 'wb-ai-steps' }, h('span', { className: 'wb-ai-step on' }, h(Spinner), 'AI 正在读取关联日报…')),
          h('div', { className: 'wb-progress ai' }, h('i', { style: { width: '55%' } })),
          h('div', { className: 'wb-hint' }, `${String(ai?.model ?? '').split('/').pop() || '模型'} 正在评估，通常需要 10–20 秒`))
        : phase === 'done'
          ? suggestions.length
            ? h(React.Fragment, null,
              h('div', { className: 'wb-row' }, h(AiTag, { model: ai?.model }), h('span', { className: 'wb-hint' }, `建议 ${suggestions.length} 项，勾选后采纳`)),
              suggestions.map((item, index) => h('div', { key: `${item.id}-${index}`, className: 'wb-ai-item' },
                h('button', {
                  type: 'button', className: `wb-check sel${selected.has(index) ? ' on' : ''}`, role: 'checkbox',
                  'aria-checked': selected.has(index), 'aria-label': '选择这条建议',
                  onClick: () => setSelected((current) => {
                    const next = new Set(current)
                    if (next.has(index)) next.delete(index); else next.add(index)
                    return next
                  }),
                }),
                h('div', { style: { flex: 1, minWidth: 0 } },
                  h('div', { className: 'wb-small', style: { fontWeight: 600 } }, item.title),
                  h('div', { className: 'wb-small wb-muted' }, `${item.from}% → ${item.to}%`),
                  h('div', { className: 'wb-hint' }, `依据：${item.reason || '关联日报有推进'}`)))))
            : h('div', { className: 'wb-empty-state' }, h('b', null, '没有找到可更新的进度'), h('div', { className: 'wb-small' }, '关联日报里暂时没有能支撑进度变化的内容。'))
          : h(React.Fragment, null,
            h('div', { className: 'wb-hint' }, `AI 会读取和「${goal.title}」相关的日报，给出建议进度和依据，你确认后才会更新。`),
            off ? h(AiOffHint, { ai, manualText: '可以先用「手工更新」页签。' }) : null,
            h('button', {
              className: 'wb-btn ai', disabled: off, title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : '开始评估',
              onClick: evaluate,
            }, h(SparkIcon), '开始评估'))
      return h(Modal, {
        title: `更新进度 · ${goal.title}`, size: 'md', onClose,
        footer: [
          h('button', { key: 'cancel', className: 'wb-btn', onClick: onClose }, '取消'),
          tab === 'manual'
            ? h('button', { key: 'save', className: 'wb-btn primary', disabled: Boolean(busy), onClick: submit }, busy === 'save' ? '保存中…' : '保存')
            : h('button', {
              key: 'apply', className: 'wb-btn ai', disabled: !selected.size || Boolean(busy), onClick: applyAi,
            }, busy === 'apply' ? '采纳中…' : `采纳选中（${selected.size}）`),
        ],
      },
        h('div', { className: 'wb-seg', role: 'tablist' },
          h('button', { role: 'tab', className: tab === 'manual' ? 'on' : '', onClick: () => setTab('manual') }, '手工更新'),
          h('button', { role: 'tab', className: tab === 'ai' ? 'on' : '', onClick: () => setTab('ai') }, h(SparkIcon), ' AI 更新')),
        tab === 'manual' ? manualBody : aiBody,
      )
    }

    /** 一次性更新所有叶子目标的进度：AI 读取最近的日报 / 汇总，给出建议，确认后批量写入。 */
    function BatchProgressModal({ ai, onClose, onApplied, show }) {
      const off = aiOffOf(ai)
      const [phase, setPhase] = useState('idle')
      const [suggestions, setSuggestions] = useState([])
      const [selected, setSelected] = useState(new Set())
      const [total, setTotal] = useState(0)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')

      const evaluate = async () => {
        if (off) { setPhase('done'); return }
        setPhase('running'); setError(''); setBusy('evaluate')
        try {
          const data = await request('/goals/ai-progress-batch', {})
          const list = (data.suggestions ?? []).map((item) => ({ ...item, checked: true }))
          setSuggestions(list)
          setSelected(new Set(list.map((_, index) => index)))
          setTotal(data.total ?? list.length)
          setPhase('done')
          if (!list.length) show('AI 这次没有找到可更新的进度')
        } catch (err) {
          setPhase('idle')
          setError(err.message)
        } finally { setBusy('') }
      }

      const apply = async () => {
        const picked = suggestions.filter((_, index) => selected.has(index))
        if (!picked.length || busy) return
        setBusy('apply')
        try {
          const data = await request('/goals/ai-progress-batch/apply', {
            items: picked.map((item) => ({ goalId: item.id, progress: item.to, reason: item.reason })),
          })
          await onApplied?.()
          show(`已更新 ${data.updated?.length ?? 0} 个目标的进度`)
          onClose()
        } catch (err) { setError(err.message) } finally { setBusy('') }
      }

      const toggle = (index) => setSelected((current) => {
        const next = new Set(current)
        if (next.has(index)) next.delete(index); else next.add(index)
        return next
      })

      const action = phase === 'running'
        ? { label: '评估中…', disabled: true }
        : phase === 'idle' && error
          ? { label: '重试', onClick: () => void evaluate() }
          : phase === 'idle'
            ? { label: '开始评估', onClick: () => void evaluate() }
            : suggestions.length
              ? { label: busy === 'apply' ? '更新中…' : `一键更新选中（${selected.size}）`, onClick: apply, disabled: !selected.size }
              : { label: '重新评估', onClick: () => void evaluate() }

      const body = off
        ? h(AiOffHint, { ai, manualText: '可以在单个目标上用「AI 更新进度」或「手工更新进度」。' })
        : phase === 'running'
          ? h('div', { className: 'wb-ai-panel' },
            h('div', { className: 'wb-ai-steps' }, h('span', { className: 'wb-ai-step on' }, h(Spinner), 'AI 正在读取最近的日报和汇总…')),
            h('div', { className: 'wb-progress ai' }, h('i', { style: { width: '55%' } })),
            h('div', { className: 'wb-hint' }, `${String(ai?.model ?? '').split('/').pop() || '模型'} 正在评估所有目标的进度，通常需要 10–20 秒`))
          : phase === 'done'
            ? suggestions.length
              ? h(React.Fragment, null,
                h('div', { className: 'wb-row', style: { marginBottom: 4 } },
                  h(AiTag, { model: ai?.model }),
                  h('span', { className: 'wb-hint' }, `扫描 ${total} 个目标，建议更新 ${suggestions.length} 个`),
                  h('div', { className: 'wb-spacer' }),
                  h('button', { className: 'wb-btn ghost sm', onClick: () => void evaluate() }, '重新评估'),
                  h('button', {
                    className: 'wb-btn ghost sm',
                    onClick: () => setSelected(selected.size === suggestions.length ? new Set() : new Set(suggestions.map((_, index) => index))),
                  }, selected.size === suggestions.length ? '全部取消' : '全选')),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 380, overflow: 'auto' } },
                  suggestions.map((item, index) => h('div', { key: `${item.id}-${index}`, className: 'wb-ai-item' },
                    h('button', {
                      type: 'button', className: `wb-check sel${selected.has(index) ? ' on' : ''}`, role: 'checkbox',
                      'aria-checked': selected.has(index), 'aria-label': '选择这条建议',
                      onClick: () => toggle(index),
                    }),
                    h('div', { style: { flex: 1, minWidth: 0 } },
                      h('div', { className: 'wb-row', style: { gap: 6 } },
                        h('span', { className: 'wb-small', style: { fontWeight: 600 } }, item.title),
                        item.cycle ? h('span', { className: 'wb-small wb-muted' }, item.cycle) : null),
                      h('div', { className: 'wb-small wb-muted' }, `${item.from}% → ${item.to}%`),
                      h('div', { className: 'wb-hint' }, `依据：${item.reason || '根据日报和周报的推进'}`))))))
              : h('div', { className: 'wb-empty-state' },
                h('b', null, '没有找到可更新的进度'),
                h('div', { className: 'wb-small' }, '日报和周报里暂时没有能支撑目标进度变化的内容。'))
            : error
              ? h('div', { className: 'wb-empty-state' },
                h('b', null, '评估失败'),
                h('div', { className: 'wb-small' }, error))
              : h('div', { className: 'wb-hint' }, 'AI 会读取最近的日报和汇总，为每个目标给出建议进度；你确认后才会写入，最多 +30%。点下方「开始评估」才会调用 AI。')

      return h(Modal, {
        title: 'AI 更新进度 · 所有目标',
        size: 'md',
        onClose,
        footer: [
          h('button', { key: 'cancel', className: 'wb-btn', onClick: onClose }, '取消'),
          h('button', {
            key: 'action', className: 'wb-btn ai', disabled: off || Boolean(action.disabled), onClick: action.onClick,
          }, action.label),
        ],
      },
        body,
        error && phase === 'done' ? h('div', { className: 'wb-field-error', style: { marginTop: 8 } }, error) : null,
      )
    }

    function GoalCard({ goal, goals, alerts, onEdit, onDelete, onProgress, onAddChild, onRelated }) {
      const kids = goals.filter((item) => item.parentId === goal.id)
      const hasKids = kids.length > 0
      const [value, setValue] = useState(goal.progress)
      const expandKey = `wb.goal.expand.${goal.id}`
      const [collapsed, setCollapsed] = useState(() => {
        try { return window.localStorage?.getItem(`${expandKey}.collapsed`) === '1' } catch { return false }
      })
      const [openKids, setOpenKids] = useState(() => {
        try { return JSON.parse(window.localStorage?.getItem(`${expandKey}.kids`) ?? '{}') } catch { return {} }
      })
      useEffect(() => { setValue(goal.progress) }, [goal.progress])
      const badges = []
      if ((alerts?.[goal.id] ?? []).includes('stale')) badges.push(h('span', { key: 's', className: 'wb-badge warn' }, '停滞'))
      if ((alerts?.[goal.id] ?? []).includes('risk')) badges.push(h('span', { key: 'r', className: 'wb-badge risk' }, '风险'))
      const common = (target) => [
        { label: '手工更新进度', onClick: () => onProgress(target, 'manual') },
        { label: 'AI 更新进度', ai: true, onClick: () => onProgress(target, 'ai') },
        { label: '查看关联日报', onClick: () => onRelated(target) },
        { label: '编辑', onClick: () => onEdit(target) },
        ...(CHILD_CYCLE[target.cycle] ? [{ label: '＋ 子目标', onClick: () => onAddChild(target) }] : []),
        { label: '删除', danger: true, onClick: () => onDelete(target) },
      ]
      // 子目标按任意深度递归渲染：年 → 季度 → 月 → 周 四层都能展开，不再固定只画两层。
      const renderKid = (kid) => {
        const sub = goals.filter((item) => item.parentId === kid.id)
        const open = Boolean(openKids[kid.id])
        return h('div', { key: kid.id, className: 'wb-kr' },
          h('div', { className: 'wb-kr-head' },
            h('span', { className: `wb-cycle-badge ${kid.cycle}` }, kid.cycle),
            h('span', { className: 'wb-kr-title', title: kid.detail ? `${kid.title}｜${kid.detail}` : kid.title }, kid.title),
            h('button', { className: 'wb-kr-pct', title: '更新进度', onClick: () => onProgress(kid, 'manual') }, `${kid.progress}% ▾`),
            h('div', { className: 'wb-okr-child-actions' },
              sub.length
                ? h('button', {
                  className: 'wb-chip',
                  title: open ? '收起子目标' : '展开子目标',
                  style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontWeight: 650, color: 'var(--wb-accent)', borderColor: 'var(--wb-accent)', background: 'rgba(59,130,246,.10)' },
                  onClick: () => {
                    const next = { ...openKids, [kid.id]: !open }
                    setOpenKids(next)
                    try { window.localStorage?.setItem(`${expandKey}.kids`, JSON.stringify(next)) } catch { /* 忽略 */ }
                  },
                }, open ? '▾ 收起' : `▸ 子目标 ${sub.length}`)
                : null,
              h(GoalMenu, { items: common(kid) }),
            ),
          ),
          h('div', { className: 'wb-kr-bar' }, h('i', { style: { width: `${Math.max(0, Math.min(100, kid.progress))}%` } })),
          sub.length ? h('div', { className: 'wb-small wb-muted' }, kid.manual === true
            ? '已手动设置进度；子目标变化不会覆盖它'
            : `由 ${sub.length} 个子目标平均计算；手动更新后以手动值为准`) : null,
          sub.length && open ? h('div', { className: 'wb-okr-krs' }, sub.map((child) => renderKid(child))) : null,
        )
      }
      return h('div', { className: 'wb-okr' },
        h('div', { className: 'wb-okr-head' },
          h('button', { className: 'wb-btn ghost', title: collapsed ? '展开' : '收起', onClick: () => {
            const next = !collapsed
            setCollapsed(next)
            try { window.localStorage?.setItem(`${expandKey}.collapsed`, next ? '1' : '0') } catch { /* 忽略 */ }
          } }, collapsed ? '▸' : '▾'),
          h('span', { className: 'wb-okr-o' }, 'O'),
          h('div', { className: 'wb-okr-title' }, goal.title),
          h('span', { className: `wb-cycle-badge ${goal.cycle}` }, goal.cycle),
          ...badges,
          h('button', { className: 'wb-okr-pct', title: '更新进度', onClick: () => onProgress(goal, 'manual') }, `${goal.progress}% ▾`),
          h('div', { className: 'wb-okr-actions' },
            h(GoalMenu, { items: common(goal) }),
          ),
        ),
        h('div', { className: 'wb-okr-bar' }, h('i', { style: { width: `${Math.max(0, Math.min(100, goal.progress))}%` } })),
        h('div', { className: 'wb-okr-measure' }, `衡量：${goal.measure} · ${goal.startDate} ~ ${goal.endDate} · 更新于 ${goal.updatedAt}`),
        goal.detail ? h('div', { className: 'wb-okr-detail', title: goal.detail }, goal.detail) : null,
        hasKids ? h('div', { className: 'wb-small wb-muted' }, goal.manual === true
          ? '已手动设置进度；子目标变化不会覆盖它'
          : `进度由 ${kids.length} 个子目标平均计算；手动更新后以手动值为准`) : null,
        collapsed ? null : hasKids
          ? h('div', { className: 'wb-okr-krs' }, kids.map((kid) => renderKid(kid)))
          : goal.records?.length
            ? h('div', { className: 'wb-small wb-muted' }, `最近更新：${goal.records[goal.records.length - 1].reason}`)
            : null,
      )
    }

    function GoalsTimeline({ goals }) {
      if (!goals.length) return h('div', { className: 'wb-empty' }, '还没有目标。')
      const starts = goals.map((goal) => parseKey(goal.startDate)).filter((value) => Number.isFinite(value))
      const ends = goals.map((goal) => parseKey(goal.endDate)).filter((value) => Number.isFinite(value))
      if (!starts.length || !ends.length) return h('div', { className: 'wb-empty' }, '目标缺少起止日期。')
      let min = Math.min(...starts)
      let max = Math.max(...ends)
      const pad = Math.max(86_400_000, (max - min) * 0.03)
      min -= pad
      max += pad
      const span = Math.max(1, max - min)
      const pct = (value) => Math.max(0, Math.min(100, ((value - min) / span) * 100))
      const todayPct = pct((dateOfKey(todayKey())?.getTime() ?? Date.now()) + 43_200_000)
      const fmt = (value) => {
        const d = new Date(value)
        return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')}`
      }
      const inRange = todayPct > 0 && todayPct < 100
      return h('div', { className: 'wb-timeline' },
        h('div', { className: 'wb-tl-axis' },
          h('span', null, fmt(min)),
          h('span', null, fmt((min + max) / 2)),
          h('span', null, fmt(max)),
          inRange ? h('span', { className: 'wb-tl-today-label', style: { left: `${todayPct}%` } }, '今天') : null),
        goals.slice(0, 80).map((goal) => {
          const left = pct(parseKey(goal.startDate))
          const right = pct(parseKey(goal.endDate) + 86_400_000)
          const width = Math.max(0.6, right - left)
          return h('div', { key: goal.id, className: 'wb-tl-row', title: `${goal.title}｜${goal.startDate} ~ ${goal.endDate}｜${goal.progress}%` },
            h('div', { className: 'wb-tl-label', style: { paddingLeft: (goal.depth ?? 0) * 12 } },
              h('span', { className: `wb-cycle-badge ${goal.cycle}` }, goal.cycle),
              goal.title),
            h('div', { className: 'wb-tl-track' },
              h('div', { className: 'wb-tl-bar', style: { left: `${left}%`, width: `${width}%` } },
                h('div', { className: 'wb-tl-fill', style: { width: `${Math.max(0, Math.min(100, Number(goal.progress) || 0))}%` } })),
              h('div', { className: 'wb-tl-today', style: { left: `${todayPct}%` } }),
            ),
          )
        }),
      )
    }

    function formatLocalStamp(value) {
      const text = String(value ?? '')
      let year; let month; let day; let hour; let minute
      if (/^\d{4}-\d{2}-\d{2}T/.test(text) && /(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
        const date = new Date(text)
        if (Number.isNaN(date.getTime())) return text || '—'
        const parts = zoneParts(date)
        year = parts.year; month = parts.month; day = parts.day; hour = parts.hour; minute = parts.minute
      } else {
        const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(text)
        if (!match) return text || '—'
        year = Number(match[1]); month = Number(match[2]); day = Number(match[3]); hour = Number(match[4]); minute = Number(match[5])
      }
      const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
      if (key === todayKey()) return `今天 ${hhmm}`
      if (key === shiftKey(todayKey(), -1)) return `昨天 ${hhmm}`
      return `${key} ${hhmm}`
    }

    function parseKey(key) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''))
      if (!match) return NaN
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
    }

    /** 导入预览按树的先序排列（上级在前），并修正 parentIndex；上级周期不比自己高的改为顶层。
     *  keep 支持「只导入勾选的目标」：被排除的上级会被跳过，子目标改挂到最近的保留上级，避免下标错位。 */
    function importTreeOrder(list, keep) {
      const kept = new Set(list.map((_, i) => i).filter((i) => (keep ? keep(i) : true)))
      const parentOf = (goal, i) => {
        const pi = goal.parentIndex
        return pi !== null && pi !== undefined && pi !== i && list[pi] && (CYCLE_RANK[list[pi].cycle] ?? 0) > (CYCLE_RANK[goal.cycle] ?? 0) ? pi : null
      }
      const nearestKept = (i) => {
        let pi = parentOf(list[i], i)
        const seen = new Set([i])
        while (pi !== null && !kept.has(pi) && !seen.has(pi)) { seen.add(pi); pi = parentOf(list[pi], pi) }
        return pi !== null && kept.has(pi) ? pi : null
      }
      const parentMap = new Map([...kept].map((i) => [i, nearestKept(i)]))
      const order = []
      const visit = (i) => {
        order.push(i)
        for (const j of kept) if (parentMap.get(j) === i) visit(j)
      }
      for (const i of kept) if (parentMap.get(i) === null) visit(i)
      const at = new Map(order.map((oldIndex, idx) => [oldIndex, idx]))
      return order.map((oldIndex) => {
        const goal = list[oldIndex]
        const pi = parentMap.get(oldIndex)
        return { ...goal, parentIndex: pi === null || pi === undefined ? null : at.get(pi) }
      })
    }

    /** 某个周期的默认起止日期，锚点用目标原来的开始日期。改周期时同步改日期，避免季度目标留着整年日期。 */
    function cycleRangeOf(cycle, anchorKey) {
      const base = dateOfKey(anchorKey) ?? nowInZone()
      const y = base.getFullYear()
      if (cycle === '年') return { startDate: keyOf(new Date(y, 0, 1)), endDate: keyOf(new Date(y, 11, 31)) }
      if (cycle === '季度') {
        const q = Math.floor(base.getMonth() / 3)
        return { startDate: keyOf(new Date(y, q * 3, 1)), endDate: keyOf(new Date(y, q * 3 + 3, 0)) }
      }
      if (cycle === '月') return { startDate: keyOf(new Date(y, base.getMonth(), 1)), endDate: keyOf(new Date(y, base.getMonth() + 1, 0)) }
      const monday = new Date(y, base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7))
      return { startDate: keyOf(monday), endDate: keyOf(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)) }
    }

    function GoalsTab({ refreshState, show, suggestions, onApplySuggestion, onDismissSuggestion, ai, settings, onOpenNorthStar }) {
      const [goals, setGoals] = useState([])
      const [alerts, setAlerts] = useState({})
      const [loading, setLoading] = useState(true)
      const [loadError, setLoadError] = useState('')
      const [view, setView] = useState('list')
      const [creating, setCreating] = useState(null)
      const [editing, setEditing] = useState(null)
      const [removing, setRemoving] = useState(null)
      const [related, setRelated] = useState(null)
      const [progress, setProgress] = useState(null)
      const [busy, setBusy] = useState('')
      const [importOpen, setImportOpen] = useState(false)
      const [batchProgress, setBatchProgress] = useState(false)
      const [importText, setImportText] = useState('')
      const [preview, setPreview] = useState([])
      const [importEditing, setImportEditing] = useState('')
      const [importCollapsed, setImportCollapsed] = useState({})
      const [northStar, setNorthStar] = useState(null)
      const [visionRevealed, setVisionRevealed] = useState(false)
      const [guideDismissed, setGuideDismissed] = useState(() => {
        try { return window.localStorage?.getItem('wb.northstar.introDismissed') === '1' } catch { return false }
      })
      const fileRef = useRef(null)
      useEffect(() => {
        let alive = true
        request('/northstar').then((data) => { if (alive) setNorthStar(data) }).catch(() => {})
        return () => { alive = false }
      }, [])

      const load = useCallback(async () => {
        try {
          const data = await request('/goals')
          setGoals(data.goals ?? [])
          setAlerts(data.alerts ?? {})
          setLoadError('')
        } catch (error) {
          setLoadError(error.message)
          show('目标没加载出来，请重试', 'error')
        } finally { setLoading(false) }
      }, [show])
      useEffect(() => { void load() }, [load])

      const roots = goals.filter((goal) => !goal.parentId)
      const treeOrder = (() => {
        const out = []
        const walk = (parentId, depth) => {
          for (const goal of goals.filter((item) => (item.parentId || null) === parentId)) {
            out.push({ ...goal, depth })
            walk(goal.id, depth + 1)
          }
        }
        walk(null, 0)
        return out
      })()
      const openProgress = (goal, tab = 'manual') => setProgress({ goal, tab })
      const off = aiOffOf(ai)
      const descendantsOf = (rootId) => {
        const out = []
        const seen = new Set([rootId])
        const queue = [rootId]
        while (queue.length) {
          const current = queue.shift()
          for (const goal of goals) {
            if (goal.parentId === current && !seen.has(goal.id)) {
              seen.add(goal.id)
              out.push(goal)
              queue.push(goal.id)
            }
          }
        }
        return out
      }
      const removingDescendants = removing ? descendantsOf(removing.id) : []
      const confirmDelete = async (withDescendants = false) => {
        if (!removing) return
        const snapshot = removing
        const childIds = goals.filter((goal) => goal.parentId === snapshot.id).map((goal) => goal.id)
        setBusy('delete')
        try {
          const data = await request('/goals/delete', { id: snapshot.id, withDescendants })
          const removedGoals = Array.isArray(data.removedGoals) && data.removedGoals.length ? data.removedGoals : [data.removed ?? snapshot]
          setRemoving(null)
          await load(); await refreshState()
          const extra = Math.max(0, removedGoals.length - 1)
          show(`已删除「${snapshot.title}」${withDescendants && extra ? `及 ${extra} 个下级目标` : ''}，6 秒内可撤销`, 'ok', async () => {
            try {
              if (withDescendants) await request('/goals', { restoreGoals: removedGoals })
              else await request('/goals', { restore: data.removed ?? snapshot, childIds })
              await load(); await refreshState()
              show('已撤销删除')
            } catch (error) { show(error.message, 'error') }
          })
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }

      const parseImport = async (files) => {
        if (off) { show(`AI 暂时不可用：${aiReasonOf(ai)}`, 'error'); return }
        setBusy('parse')
        try {
          const payload = { text: importText.trim() }
          if (files?.length) {
            payload.files = []
            for (const file of files) {
              if (file.size > 30 * 1024 * 1024) { show(`${file.name} 超过 30MB`, 'error'); continue }
              payload.files.push({ name: file.name, dataBase64: toBase64(await file.arrayBuffer()) })
            }
          }
          if (!payload.text && !payload.files?.length) { show('先粘贴文本或选择文件', 'error'); return }
          const data = await request('/goals/import/parse', payload)
          setPreview((data.goals ?? []).map((goal, index) => ({ ...goal, key: `${index}-${goal.title}` })))
          show(`拆出 ${data.goals?.length ?? 0} 个目标${data.truncated ? '（文档过长，只处理了前 8 段）' : ''}${data.partial ? '（模型输出被截断，部分目标可能缺失，可重新拆解）' : ''}，确认后保存`)
        } catch (error) { show(error.message, 'error') } finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
      }

      const saveImport = async () => {
        if (!preview.length) return
        setBusy('save')
        try {
          const data = await request('/goals/import/save', { goals: importTreeOrder(preview).map(({ key, ...rest }) => rest) })
          setPreview([]); setImportOpen(false); setImportText('')
          await load(); await refreshState()
          show(`已写入 ${data.created.length} 个目标`)
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }

      return h(React.Fragment, null,
        h(Suggestions, { items: suggestions, onApply: onApplySuggestion, onDismiss: onDismissSuggestion }),
        northStar?.exists
          ? h('div', { className: 'wb-ns-strip' },
            h('span', { className: 'wb-ns-strip-label' }, '一句话愿景'),
            h('span', { className: `wb-ns-strip-text${settings?.northStar?.blur !== false && !visionRevealed ? ' blurred' : ''}` }, northStar.vision || '（还没写）'),
            settings?.northStar?.blur !== false
              ? h('button', { className: 'wb-btn ghost sm', onClick: () => setVisionRevealed(!visionRevealed) }, visionRevealed ? '遮挡' : '显示')
              : null,
            h('button', { className: 'wb-btn ghost sm', onClick: onOpenNorthStar }, '去北极星'))
          : (!guideDismissed
            ? h('div', { className: 'wb-ns-guide' },
              h('div', { className: 'wb-ns-guide-text' },
                h('b', null, '给目标找个方向'),
                h('div', { className: 'wb-hint' }, '约 15 分钟，可跳过。写下北极星后，目标和杠杆会更有方向。')),
              h('div', { className: 'wb-spacer' }),
              h('button', { className: 'wb-btn sm ai', onClick: onOpenNorthStar }, '去写北极星'),
              h('button', {
                className: 'wb-btn sm ghost',
                onClick: () => {
                  setGuideDismissed(true)
                  try { window.localStorage?.setItem('wb.northstar.introDismissed', '1') } catch { /* 忽略 */ }
                },
              }, '知道了'))
            : null),
        h('div', { className: 'wb-card' },
          h('div', { className: 'wb-card-head' },
            h('div', { className: 'wb-card-title' }, '我的目标'),
            h('span', { className: 'wb-badge' }, `${goals.length} 个`),
            h('div', { className: 'wb-seg', role: 'group', 'aria-label': '视图' },
              h('button', { className: view === 'list' ? 'on' : '', onClick: () => setView('list') }, '列表'),
              h('button', { className: view === 'timeline' ? 'on' : '', onClick: () => setView('timeline') }, '时间轴')),
            h('div', { className: 'wb-spacer' }),
            h('button', { className: 'wb-icon-btn', title: '刷新', 'aria-label': '刷新', onClick: load }, h(RefreshIcon)),
            h('button', {
              className: 'wb-btn ai sm', disabled: off, title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : '让 AI 读取最近的日报和汇总，一次性更新所有目标的进度',
              onClick: () => setBatchProgress(true),
            }, h(SparkIcon), 'AI 更新进度'),
            h('button', {
              className: 'wb-btn ai-2 sm', disabled: off, title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : '导入目标',
              onClick: () => setImportOpen(!importOpen),
            }, h(SparkIcon), '导入目标'),
            h('button', { className: 'wb-btn primary sm', onClick: () => setCreating({ parentId: '' }) }, '＋ 新建目标'),
          ),
          h('div', { className: 'wb-sep' }),
          loading
            ? h('div', { style: { padding: '4px 0' } }, h(Skeleton, { rows: 5 }))
            : loadError
              ? h('div', { className: 'wb-empty-state' },
                h('b', null, '目标没加载出来'),
                h('div', { className: 'wb-small' }, '可能是插件服务刚重启。'),
                h('button', { className: 'wb-btn primary sm', onClick: () => { setLoading(true); void load() } }, '重试'))
            : view === 'timeline'
            ? h(GoalsTimeline, { goals: treeOrder })
            : roots.length
              ? CYCLES.map((cycle) => {
                const group = roots.filter((goal) => goal.cycle === cycle)
                if (!group.length) return null
                const cards = group.map((goal) => h(GoalCard, {
                  key: goal.id, goal, goals, alerts,
                  onEdit: (target) => setEditing(target),
                  onDelete: (target) => setRemoving(target),
                  onProgress: openProgress,
                  onAddChild: (target) => setCreating({ parentId: target.id, cycle: CHILD_CYCLE[target.cycle] ?? '周' }),
                  onRelated: (target) => setRelated(target),
                }))
                return h('div', { key: cycle, className: 'wb-cycle' },
                  h('div', { className: 'wb-cycle-title' }, cycle === '季度' ? '季度目标' : `${cycle}度目标`),
                  cycle === '年' ? h('div', { className: 'wb-okr-grid' }, cards) : cards,
                )
              })
              : h(EmptyState, {
                title: '还没有目标',
                text: '把一份计划文档或一段话交给 AI，它会拆成年、季度、月、周目标。',
                action: h('div', { className: 'wb-row', style: { justifyContent: 'center' } },
                  h('button', {
                    className: 'wb-btn ai sm', disabled: off, title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : '导入目标',
                    onClick: () => setImportOpen(true),
                  }, h(SparkIcon), '用文字或文件让 AI 拆解'),
                  h('button', { className: 'wb-btn sm', onClick: () => setCreating({ parentId: '' }) }, '手动新建')),
              }),
        ),
        creating ? h(GoalFormModal, {
          goals, parentId: creating.parentId, cycle: creating.cycle, ai,
          onClose: () => setCreating(null),
          onSaved: async () => { await load(); await refreshState() }, show,
        }) : null,
        editing ? h(GoalFormModal, {
          goal: editing, goals, ai,
          onClose: () => setEditing(null),
          onSaved: async () => { await load(); await refreshState() }, show,
        }) : null,
        related ? h(RelatedReportsModal, { goal: related, onClose: () => setRelated(null), show }) : null,
        progress ? h(ProgressModal, {
          goal: progress.goal, initialTab: progress.tab, ai,
          onClose: () => setProgress(null),
          onApplied: async () => { await load(); await refreshState() },
          show,
        }) : null,
        batchProgress ? h(BatchProgressModal, {
          ai,
          onClose: () => setBatchProgress(false),
          onApplied: async () => { await load(); await refreshState() },
          show,
        }) : null,
        removing ? (() => {
          const count = removingDescendants.length
          const deleting = busy === 'delete'
          return h(Modal, {
            title: '删除目标',
            onClose: () => { if (!deleting) setRemoving(null) },
            footer: [
              h('button', { key: 'cancel', className: 'wb-btn', disabled: deleting, onClick: () => setRemoving(null) }, '取消'),
              count ? h('button', { key: 'single', className: 'wb-btn danger', disabled: deleting, onClick: () => confirmDelete(false) }, '只删除当前目标') : null,
              h('button', {
                key: 'delete', className: 'wb-btn danger-solid', disabled: deleting,
                onClick: () => confirmDelete(count > 0),
              }, deleting ? '删除中…' : (count ? `一起删除（${count + 1} 个）` : '删除')),
            ],
          },
            h('div', { className: 'wb-small' }, `确定删除「${removing.title}」？`),
            count
              ? h('div', { className: 'wb-small wb-muted' },
                `它还有 ${count} 个下级目标。选「只删除当前目标」会解除父子关联并保留下级；选「一起删除」会连同所有下级一起删除。`)
              : null,
            h('div', { className: 'wb-small wb-muted' }, '删除后 6 秒内可以在提示条里撤销。'))
        })() : null,
        importOpen ? h(Modal, { title: '导入目标', wide: true, onClose: () => setImportOpen(false) },
          !preview.length ? h(React.Fragment, null,
            h('div', { className: 'wb-small', style: { color: 'var(--wb-text-3)' } },
              '支持 .docx / .xlsx / .pptx / .md / .txt，也可以直接粘贴文字。AI 会按 年 → 季度 → 月 → 周 拆解，导入前可以预览和修改。'),
            h('div', {
              className: 'wb-srccard', style: { borderStyle: 'dashed', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '18px 14px', cursor: 'pointer' },
              onClick: () => fileRef.current?.click(),
              onDragOver: (event) => { event.preventDefault() },
              onDrop: (event) => { event.preventDefault(); void parseImport(event.dataTransfer?.files) },
            },
              h('b', null, '拖入文件，或选择文件'),
              h('span', { className: 'wb-small' }, '支持 .docx / .xlsx / .pptx / .md / .txt，最大 30MB')),
            h('textarea', { className: 'wb-textarea', rows: 4, placeholder: '或者粘贴文字，例如：明年要把线上事故减少一半，第一季度完成监控告警改造……', value: importText, onChange: (event) => setImportText(event.target.value) }),
            off ? h(AiOffHint, { ai, manualText: '可以先关闭这个弹窗，手动新建目标。' }) : null,
            h('div', { className: 'wb-row end' },
              h('button', {
                className: 'wb-btn ai sm', disabled: busy === 'parse' || off,
                title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : 'AI 拆解',
                onClick: () => parseImport(null),
              }, busy === 'parse' ? h(React.Fragment, null, h(Spinner), '拆解中…') : h(React.Fragment, null, h(SparkIcon), 'AI 拆解')),
            ),
          ) : null,
          h('input', {
            ref: fileRef, type: 'file', multiple: true, style: { display: 'none' },
            accept: '.md,.markdown,.txt,.docx,.doc,.xlsx,.xls,.pptx,.ppt',
            onChange: (event) => parseImport(event.target.files),
          }),
          preview.length ? (() => {
            const patch = (index, fields) => setPreview(preview.map((item, i) => i === index ? { ...item, ...fields } : item))
            const removeAt = (index) => {
              const gone = preview[index]
              const lift = gone.parentIndex === null || gone.parentIndex === undefined ? null : gone.parentIndex
              setPreview(preview.filter((_, i) => i !== index).map((item) => {
                let pi = item.parentIndex
                if (pi === index) pi = lift
                if (pi !== null && pi !== undefined && pi > index) pi -= 1
                return { ...item, parentIndex: pi }
              }))
              setImportEditing('')
            }
            const validParent = (goal, index) => {
              const pi = goal.parentIndex
              return pi !== null && pi !== undefined && pi !== index && preview[pi] && (CYCLE_RANK[preview[pi].cycle] ?? 0) > (CYCLE_RANK[goal.cycle] ?? 0) ? pi : null
            }
            const kidsOf = (pi) => preview.map((g, i) => ({ g, i })).filter(({ g, i }) => validParent(g, i) === pi)
            const roots = preview.map((g, i) => ({ g, i })).filter(({ g, i }) => validParent(g, i) === null)
            const counts = CYCLES.map((c) => [c, preview.filter((g) => g.cycle === c).length]).filter(([, n]) => n)
            const editor = (goal, index) => h('div', { className: 'wb-imp-edit', onClick: (event) => event.stopPropagation() },
              h('label', null, '目标',
                h('input', { className: 'wb-input', autoFocus: true, value: goal.title, onChange: (event) => patch(index, { title: event.target.value }) })),
              h('label', null, '详细说明',
                h('textarea', { className: 'wb-textarea', rows: 3, value: goal.detail ?? '', placeholder: '具体内容、背景或交付物（可留空）', onChange: (event) => patch(index, { detail: event.target.value }) })),
              h('label', null, '衡量方式',
                h('textarea', { className: 'wb-textarea', rows: 2, value: goal.measure, placeholder: '怎样算完成', onChange: (event) => patch(index, { measure: event.target.value }) })),
              h('div', { className: 'wb-imp-grid' },
                h('label', { style: { flex: '0 0 96px' } }, '周期',
                  h('select', {
                    className: 'wb-select', value: goal.cycle,
                    onChange: (event) => {
                      const cycle = event.target.value
                      patch(index, { cycle, ...cycleRangeOf(cycle, goal.startDate) })
                    },
                  },
                    CYCLES.map((cycle) => h('option', { key: cycle, value: cycle }, cycle)))),
                h('label', null, '上级目标',
                  h('select', {
                    className: 'wb-select', value: validParent(goal, index) === null ? '' : String(goal.parentIndex),
                    onChange: (event) => patch(index, { parentIndex: event.target.value === '' ? null : Number(event.target.value) }),
                  },
                    h('option', { value: '' }, '无上级（顶层目标）'),
                    preview.map((parent, parentIndex) => parentIndex === index || (CYCLE_RANK[parent.cycle] ?? 0) <= (CYCLE_RANK[goal.cycle] ?? 0)
                      ? null
                      : h('option', { key: parent.key, value: String(parentIndex) }, `【${parent.cycle}】${parent.title}`))))),
              h('div', { className: 'wb-row', style: { alignItems: 'center' } },
                h('span', { className: 'wb-small wb-muted', style: { flex: 1 } }, `${goal.startDate} ~ ${goal.endDate}`),
                h('button', { className: 'wb-btn ghost danger sm', onClick: () => removeAt(index) }, '删除'),
                h('button', { className: 'wb-btn sm', onClick: () => setImportEditing('') }, '完成')))
            const countDesc = (i) => kidsOf(i).reduce((sum, { i: j }) => sum + 1 + countDesc(j), 0)
            const shortDate = (d) => String(d ?? '').slice(5).replace('-', '/')
            const branch = (goal, index, depth, parentGoal) => {
              const editing = importEditing === goal.key
              const kids = kidsOf(index)
              const collapsed = !!importCollapsed[goal.key]
              const showDate = !parentGoal || parentGoal.startDate !== goal.startDate || parentGoal.endDate !== goal.endDate
              const level = `lv-${goal.cycle}`
              const row = h('div', {
                className: `wb-imp-node ${level}${depth === 0 ? ' root' : ''}${depth === 0 && !kids.length ? ' only' : ''}${editing ? ' editing' : ''}`,
                onClick: () => setImportEditing(editing ? '' : goal.key),
                title: '点击编辑',
              },
                kids.length
                  ? h('button', {
                    className: `wb-imp-caret${collapsed ? ' closed' : ''}`, 'aria-label': collapsed ? '展开' : '收起',
                    onClick: (event) => { event.stopPropagation(); setImportCollapsed({ ...importCollapsed, [goal.key]: !collapsed }) },
                  }, '▾')
                  : h('span', { className: 'wb-imp-caret empty' }),
                h('span', { className: `wb-imp-cycle c-${goal.cycle}` }, goal.cycle),
                h('div', { className: 'wb-imp-body' },
                  h('div', { className: 'wb-imp-title' }, goal.title || '（未命名目标）'),
                  goal.measure ? h('div', { className: 'wb-imp-measure' }, goal.measure) : null,
                  goal.detail ? h('div', { className: 'wb-imp-measure' }, goal.detail) : null,
                  collapsed && kids.length ? h('div', { className: 'wb-imp-meta' }, `已收起 ${countDesc(index)} 个下级目标`) : null),
                showDate ? h('span', { className: 'wb-imp-date' }, depth === 0 ? `${goal.startDate} ~ ${goal.endDate}` : `${shortDate(goal.startDate)} – ${shortDate(goal.endDate)}`) : null,
                h('div', { className: 'wb-imp-acts', onClick: (event) => event.stopPropagation() },
                  h('button', { className: 'wb-imp-act', onClick: () => setImportEditing(editing ? '' : goal.key) }, editing ? '收起' : '编辑'),
                  h('button', { className: 'wb-imp-act danger', onClick: () => removeAt(index) }, '删除')))
              const children = kids.length && !collapsed
                ? h('div', { className: 'wb-imp-kids' }, kids.map(({ g, i }) => branch(g, i, depth + 1, goal)))
                : null
              if (depth === 0) {
                return h('div', { key: goal.key, className: 'wb-imp-group' }, row, editing ? editor(goal, index) : null, children)
              }
              return h('div', { key: goal.key, className: 'wb-imp-branch' }, row, editing ? editor(goal, index) : null, children)
            }
            return h(React.Fragment, null,
              h('div', { className: 'wb-imp-src' },
                h('span', null, importText.trim() ? `原文：${importText.trim().replace(/\s+/g, ' ')}` : '已从文件拆解'),
                h('button', { className: 'wb-imp-act', onClick: () => { setPreview([]); setImportEditing('') } }, '重新输入')),
              h('div', { className: 'wb-imp-head' },
                h(AiTag, { model: ai?.model }),
                h('span', { className: 'wb-imp-count' }, `拆出 ${preview.length} 个目标`),
                h('span', { className: 'wb-imp-sub' }, '· 年 → 季度 → 月 → 周，点击任意一条可修改，确认后才写入 目标.json')),
              h('div', { className: 'wb-imp-tree' }, roots.map(({ g, i }) => branch(g, i, 0, null))),
              h('div', { className: 'wb-imp-foot' },
                h('div', { className: 'wb-imp-sum' }, '将写入 ', h('b', null, `${preview.length} 个目标`),
                  counts.length ? `（${counts.map(([c, n]) => `${c} ${n}`).join(' · ')}）` : ''),
                h('button', { className: 'wb-btn', onClick: () => { setPreview([]); setImportEditing('') } }, '清空'),
                h('button', { className: 'wb-btn primary', disabled: busy === 'save', onClick: saveImport }, busy === 'save' ? '保存中…' : '确认写入')))
          })() : null,
        ) : null,
      )
    }

    function parseQuoteLines(text) {
      const items = []
      for (const raw of String(text ?? '').split(/\r?\n/)) {
        const line = raw.trim()
        if (!line || line.startsWith('#')) continue
        let content = line
        let author = ''
        let source = ''
        const split = /^(.*?)(?:——|--|—)\s*(.*)$/.exec(line)
        if (split) {
          content = split[1].trim()
          const tail = split[2].trim()
          const book = /《([^》]+)》/.exec(tail)
          if (book) source = book[1]
          author = tail.replace(/《[^》]*》/g, '').trim()
        }
        if (content) items.push({ text: content, author, source })
      }
      return items
    }

    function QuotesSettings({ show, ai }) {
      const [data, setData] = useState({ builtin: [], custom: [], today: null })
      const [text, setText] = useState('')
      const [prompt, setPrompt] = useState('')
      const [count, setCount] = useState(5)
      const [aiQuotes, setAiQuotes] = useState([])
      const [manageOpen, setManageOpen] = useState(false)
      const [selected, setSelected] = useState(new Set())
      const [confirmDelete, setConfirmDelete] = useState(false)
      const [editingQuote, setEditingQuote] = useState(null)
      const [editText, setEditText] = useState('')
      const [query, setQuery] = useState('')
      const [busy, setBusy] = useState('')
      const fileRef = useRef(null)
      const load = useCallback(async () => {
        try { setData(await request('/quotes')) } catch (error) { show(error.message, 'error') }
      }, [show])
      useEffect(() => { void load() }, [load])
      const addItems = async (items) => {
        if (!items.length) return
        await request('/quotes/add', { items })
        setText(''); setAiQuotes([])
        await load()
        show(`已添加 ${items.length} 条名句`)
      }
      const importFile = async (files) => {
        const file = files?.[0]
        if (!file) return
        setBusy('import')
        try {
          const data = await request('/quotes/import', { name: file.name, dataBase64: toBase64(await file.arrayBuffer()) })
          await load()
          show(`已导入 ${data.added.length} 条名句`)
        } catch (error) { show(error.message, 'error') } finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
      }
      const off = aiOffOf(ai)
      const recommend = async () => {
        if (off) { show(`AI 暂时不可用：${aiReasonOf(ai)}`, 'error'); return }
        if (!prompt.trim()) { show('先写你喜欢的风格', 'error'); return }
        setBusy('ai')
        try {
          const result = await request('/quotes/ai', { prompt, count })
          setAiQuotes((result.quotes ?? []).map((quote) => ({ ...quote, checked: true })))
          show(`AI 推荐了 ${result.quotes?.length ?? 0} 条（${result.model}），确认后添加`)
        } catch (error) { show(error.message, 'error') } finally { setBusy('') }
      }
      const remove = async (id) => {
        try { await request('/quotes/delete', { id }); await load(); show('已删除') }
        catch (error) { show(error.message, 'error') }
      }
      return h('div', { className: 'wb-card' },
        h('div', { className: 'wb-card-head' },
          h('div', { className: 'wb-card-title' }, '每日一句'),
          h('span', { className: 'wb-badge' }, `内置 ${data.builtin.length} · 自定义 ${data.custom.length}`),
          h('div', { className: 'wb-spacer' }),
          data.today ? h('span', { className: 'wb-small wb-muted' }, `今天：${data.today.text.slice(0, 18)}…`) : null,
        ),
        h('div', { className: 'wb-small wb-muted' }, '每行一条，支持「名句——作者《出处》」格式；内置 100 条每天轮换。'),
        h('textarea', { className: 'wb-textarea', rows: 3, placeholder: '例如：长风破浪会有时，直挂云帆济沧海。——李白《行路难》', value: text, onChange: (event) => setText(event.target.value) }),
        h('div', { className: 'wb-row' },
          h('button', { className: 'wb-btn primary', disabled: !text.trim(), onClick: () => addItems(parseQuoteLines(text)).catch((error) => show(error.message, 'error')) }, '添加名句'),
          h('button', { className: 'wb-btn', disabled: busy === 'import', onClick: () => fileRef.current?.click() }, '导入 txt / md'),
          h('input', { ref: fileRef, type: 'file', accept: '.txt,.md,.markdown', style: { display: 'none' }, onChange: (event) => importFile(event.target.files) }),
        ),
        h('div', { className: 'wb-sep' }),
        off ? h(AiOffHint, { ai, manualText: '仍可手动添加或导入名句。' }) : null,
        h('div', { className: 'wb-row' },
          h('input', { className: 'wb-input', placeholder: '喜欢什么风格？例如：苏轼的旷达、曾国藩的家书、泰戈尔的诗', value: prompt, onChange: (event) => setPrompt(event.target.value) }),
          h('input', { className: 'wb-input', type: 'number', min: 1, max: 20, style: { maxWidth: 90 }, value: count, onChange: (event) => setCount(Number(event.target.value)) }),
          h('button', {
            className: 'wb-btn sm ai', disabled: busy === 'ai' || off,
            title: off ? `AI 暂时不可用：${aiReasonOf(ai)}` : 'AI 推荐',
            onClick: recommend,
          }, busy === 'ai' ? h(React.Fragment, null, h(Spinner), '生成中…') : h(React.Fragment, null, h(SparkIcon), 'AI 推荐')),
        ),
        aiQuotes.length ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          h('div', { className: 'wb-row' }, h(AiTag, null), h('span', { className: 'wb-small wb-muted' }, '确认后添加')),
          aiQuotes.map((quote, index) => h('div', { key: index, className: 'wb-row', style: { border: '1px solid var(--wb-border)', borderRadius: 8, padding: '6px 8px' } },
            h('button', {
              type: 'button', className: `wb-check sel${quote.checked ? ' on' : ''}`, role: 'checkbox',
              'aria-checked': Boolean(quote.checked), 'aria-label': '选择这条名句',
              onClick: () => setAiQuotes(aiQuotes.map((entry, i) => i === index ? { ...entry, checked: !entry.checked } : entry)),
            }),
            h('span', { style: { flex: 1 } }, `${quote.text} —— ${quote.author}${quote.source ? `《${quote.source}》` : ''}`),
            h('button', { className: 'wb-icon-btn', title: '移除', onClick: () => setAiQuotes(aiQuotes.filter((_, i) => i !== index)) }, '×'),
          )),
          h('div', { className: 'wb-row end' },
            h('button', { className: 'wb-btn ghost', onClick: () => setAiQuotes([]) }, '取消'),
            h('button', { className: 'wb-btn', disabled: !aiQuotes.some((quote) => quote.checked), onClick: () => addItems(aiQuotes.filter((quote) => quote.checked).map(({ checked, ...rest }) => rest)).catch((error) => show(error.message, 'error')) }, `添加选中（${aiQuotes.filter((quote) => quote.checked).length}）`),
            h('button', { className: 'wb-btn primary', onClick: () => addItems(aiQuotes.map(({ checked, ...rest }) => rest)).catch((error) => show(error.message, 'error')) }, '全部添加')),
        ) : null,
        h('div', { className: 'wb-row' },
          h('button', { className: 'wb-btn ghost', onClick: () => { setSelected(new Set()); setManageOpen(true) } }, '查看 / 管理名句'),
        ),
        manageOpen ? h(Modal, { title: '每日一句', wide: true, onClose: () => setManageOpen(false) },
          h('input', { className: 'wb-input', placeholder: '搜索名句 / 作者', value: query, onChange: (event) => setQuery(event.target.value) }),
          h('div', { className: 'wb-row' },
            h('button', { className: 'wb-btn ghost', onClick: () => {
              const visible = [...data.builtin, ...data.custom].filter((quote) => fuzzyMatch(query, `${quote.text} ${quote.author} ${quote.source}`))
              const allSelected = visible.length > 0 && visible.every((quote) => selected.has(quote.id))
              setSelected(allSelected ? new Set() : new Set(visible.map((quote) => quote.id)))
            } }, (() => {
              const visible = [...data.builtin, ...data.custom].filter((quote) => fuzzyMatch(query, `${quote.text} ${quote.author} ${quote.source}`))
              return visible.length > 0 && visible.every((quote) => selected.has(quote.id)) ? '取消全选' : '全选'
            })()),
            h('button', { className: 'wb-btn danger', disabled: !selected.size, style: { color: '#dc2626' }, onClick: () => setConfirmDelete(true) },
              `${selected.size && [...selected].every((id) => id.startsWith('d-')) ? '隐藏选中' : '删除选中'}（${selected.size}）`),
            data.hiddenCount ? h('button', { className: 'wb-btn ghost', onClick: async () => {
              try {
                const restored = await request('/quotes/unhide', { ids: data.hiddenIds ?? [] })
                await load()
                show(`已恢复 ${restored.restored} 条内置名句`)
              } catch (error) { show(error.message, 'error') }
            } }, `恢复已隐藏的内置名句（${data.hiddenCount}）`) : null,
            h('span', { className: 'wb-small wb-muted' }, (() => {
              const visible = [...data.builtin, ...data.custom].filter((quote) => fuzzyMatch(query, `${quote.text} ${quote.author} ${quote.source}`))
              return `共 ${data.builtin.length + data.custom.length} 条 · 匹配 ${visible.length} 条`
            })()),
          ),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '52vh', overflow: 'auto' } },
            [...data.builtin, ...data.custom]
              .filter((quote) => fuzzyMatch(query, `${quote.text} ${quote.author} ${quote.source}`))
              .map((quote) => h('label', { key: quote.id, className: 'wb-row', style: { fontSize: 12, padding: '3px 0', cursor: 'pointer' } },
                h('input', {
                  type: 'checkbox', checked: selected.has(quote.id),
                  onChange: () => {
                    const next = new Set(selected)
                    if (next.has(quote.id)) next.delete(quote.id); else next.add(quote.id)
                    setSelected(next)
                  },
                }),
                h('span', { style: { flex: 1 } }, `${quote.text}${quote.author ? ` —— ${quote.author}` : ''}${quote.source ? `《${quote.source}》` : ''}`),
                quote.builtin ? h('span', { className: 'wb-badge' }, '内置 · 可隐藏') : h('button', { className: 'wb-btn ghost', onClick: (event) => {
                  event.preventDefault()
                  setEditingQuote(quote); setEditText(quote.text)
                } }, '编辑'),
              )),
          ),
        ) : null,
        confirmDelete ? h(ConfirmModal, {
          title: '删除名句',
          message: (() => {
            const total = data.builtin.length + data.custom.length
            const all = selected.size >= total
            return `将删除/隐藏选中的 ${selected.size} 条名句。${all ? '这是全部名句，删完后每日一句将无法展示。' : ''}内置名句会变为隐藏，可在弹窗内恢复。`
          })(),
          confirmText: '确定',
          onCancel: () => setConfirmDelete(false),
          onConfirm: async () => {
            const selectedIds = [...selected]
            const customSnapshot = data.custom.filter((quote) => selectedIds.includes(quote.id)).map((quote) => ({ text: quote.text, author: quote.author, source: quote.source }))
            const builtinSnapshot = data.builtin.filter((quote) => selectedIds.includes(quote.id)).map((quote) => quote.id)
            try {
              const result = await request('/quotes/delete-batch', { ids: selectedIds })
              setConfirmDelete(false); setSelected(new Set()); await load()
              const parts = []
              if (result.removed) parts.push(`删除自定义 ${result.removed} 条`)
              if (result.hidden?.length) parts.push(`隐藏内置 ${result.hidden.length} 条`)
              show(`${parts.join('，') || '没有变化'}，剩余 ${result.remaining} 条`, 'ok', async () => {
                try {
                  if (customSnapshot.length) await request('/quotes/add', { items: customSnapshot })
                  if (builtinSnapshot.length) await request('/quotes/unhide', { ids: builtinSnapshot })
                  await load()
                  show('已撤销删除')
                } catch (error) { show(error.message, 'error') }
              })
            } catch (error) { show(error.message, 'error') }
          },
        }) : null,
        editingQuote ? h(Modal, {
          title: '修改名句',
          onClose: () => setEditingQuote(null),
          footer: [
            h('button', { key: 'cancel', className: 'wb-btn', onClick: () => setEditingQuote(null) }, '取消'),
            h('button', {
              key: 'save', className: 'wb-btn primary', disabled: !editText.trim(),
              onClick: async () => {
                try {
                  await request('/quotes/update', { id: editingQuote.id, text: editText })
                  setEditingQuote(null); await load(); show('已修改')
                } catch (error) { show(error.message, 'error') }
              },
            }, '保存'),
          ],
        },
          h('label', { className: 'wb-form-field' }, '名句内容',
            h('textarea', {
              className: 'wb-textarea', rows: 3, value: editText, autoFocus: true,
              onChange: (event) => setEditText(event.target.value),
            }))) : null,
      )
    }

    function SettingsTab({ state, refresh, show, ai }) {
      const [form, setForm] = useState(null)
      const [dirty, setDirty] = useState(false)
      const [sharePreview, setSharePreview] = useState(null)
      const [nowTick, setNowTick] = useState(() => new Date())
      useEffect(() => {
        const timer = setInterval(() => setNowTick(new Date()), 1000)
        return () => clearInterval(timer)
      }, [])
      useEffect(() => {
        if (dirty) return
        setForm({
          ...state.settings,
          holidaysText: (state.settings.holidays ?? []).join('\n'),
          extraText: (state.settings.extraWorkdays ?? []).join('\n'),
        })
      }, [state.settings, dirty])
      useEffect(() => {
        if (!form?.northStar?.shareWithAI) { setSharePreview(null); return undefined }
        let alive = true
        request('/northstar').then((data) => {
          if (!alive) return
          setSharePreview(data?.exists
            ? [data.vision ? `一句话愿景：${data.vision}` : '', Array.isArray(data.rules) && data.rules.length ? `规则：${data.rules.join('；')}` : ''].filter(Boolean).join('\n')
            : '（还没有北极星）')
        }).catch(() => { if (alive) setSharePreview('（读取失败）') })
        return () => { alive = false }
      }, [form?.northStar?.shareWithAI])
      if (!form) return null
      const off = aiOffOf(ai)
      const set = (key, value) => { setForm({ ...form, [key]: value }); setDirty(true) }
      const reset = () => {
        setForm({
          ...state.settings,
          holidaysText: (state.settings.holidays ?? []).join('\n'),
          extraText: (state.settings.extraWorkdays ?? []).join('\n'),
        })
        setDirty(false)
      }
      const setAppearance = async (key, value) => {
        setForm((current) => ({ ...current, [key]: value }))
        try { await request('/settings', { settings: { [key]: value } }); await refresh() }
        catch (error) { show(error.message, 'error'); setDirty(true) }
      }
      const save = async () => {
        try {
          const city = form.region || form.weatherCity || ''
          const settings = {
            ...form,
            region: city,
            weatherCity: city,
            timezone: tzForRegion(city),
            holidays: String(form.holidaysText ?? '').split(/[\s,，]+/).filter(Boolean),
            extraWorkdays: String(form.extraText ?? '').split(/[\s,，]+/).filter(Boolean),
          }
          delete settings.holidaysText
          delete settings.extraText
          const data = await request('/settings', { settings })
          setForm({
            ...(data.settings ?? settings),
            holidaysText: String(form.holidaysText ?? ''),
            extraText: String(form.extraText ?? ''),
          })
          setDirty(false)
          await refresh()
          show('设置已保存')
        } catch (error) { show(error.message, 'error') }
      }
      const dirtyCount = [
        ...Object.keys(form).filter((key) => !['holidaysText', 'extraText'].includes(key)
          && JSON.stringify(form[key]) !== JSON.stringify(state.settings[key])),
        ...(String(form.holidaysText ?? '') !== (state.settings.holidays ?? []).join('\n') ? ['holidays'] : []),
        ...(String(form.extraText ?? '') !== (state.settings.extraWorkdays ?? []).join('\n') ? ['extraWorkdays'] : []),
      ].length
      const section = (title, desc, ...children) => h('div', { className: 'wb-card', key: title },
        h('div', { className: 'wb-card-title' }, title),
        desc ? h('div', { className: 'wb-hint', style: { marginTop: -4 } }, desc) : null,
        h('div', { className: 'wb-settings-body' }, children))
      const srow = (name, desc, control) => h('div', { className: 'wb-srow', key: name },
        h('div', { className: 'wb-srow-text' },
          h('div', { className: 'wb-srow-name' }, name),
          desc ? h('div', { className: 'wb-hint' }, desc) : null),
        h('div', { className: 'wb-srow-control' }, control))
      const Switch = ({ checked, onChange, label }) => h('button', {
        type: 'button', className: `wb-switch${checked ? ' on' : ''}`, role: 'switch',
        'aria-checked': Boolean(checked), 'aria-label': label, onClick: () => onChange(!checked),
      })
      const northStar = form.northStar ?? { shareWithAI: false, blur: true }
      const setNorthStar = (patch) => {
        setForm({ ...form, northStar: { ...northStar, ...patch } })
        setDirty(true)
      }
      const hm = (key, label) => {
        const [hh, mm] = String(form[key] ?? '09:00').split(':')
        return h('div', { className: 'wb-row', style: { gap: 4 } },
          h('select', {
            className: 'wb-select', style: { width: 70 }, 'aria-label': `${label}小时`, value: hh,
            onChange: (event) => set(key, `${event.target.value}:${mm ?? '00'}`),
          }, Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0')).map((value) => h('option', { key: value, value }, value))),
          h('span', { className: 'wb-small wb-muted' }, ':'),
          h('select', {
            className: 'wb-select', style: { width: 70 }, 'aria-label': `${label}分钟`, value: mm,
            onChange: (event) => set(key, `${hh}:${event.target.value}`),
          }, Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0')).map((value) => h('option', { key: value, value }, value))))
      }
      const theme = ['host', 'light', 'dark', 'time'].includes(form.themeMode) ? form.themeMode : 'host'
      return h(React.Fragment, null,
        h('div', { className: 'wb-settings' },
          section('提醒', '到点会在 DSH 里弹出提醒，并生成当天的 AI 建议。',
            srow('早安提醒', '提醒你看今天的待办', hm('morningTime', '早安提醒')),
            srow('晚报提醒', '提醒你写日报，AI 会提前整理好草稿', hm('eveningTime', '晚报提醒')),
            srow('跳过周末', '周六、周日不发提醒（调休上班日除外）',
              h(Switch, { checked: form.skipWeekends !== false, label: '跳过周末', onChange: (value) => set('skipWeekends', value) })),
            srow('目标停滞提醒天数', '目标连续几天没有进展就提醒',
              h('div', { className: 'wb-row' },
                h('div', { className: 'wb-stepper' },
                  h('button', { className: 'wb-btn sm', onClick: () => set('goalStaleDays', Math.max(1, Number(form.goalStaleDays || 3) - 1)) }, '−'),
                  h('span', { style: { minWidth: 24, textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }, String(Number(form.goalStaleDays || 3))),
                  h('button', { className: 'wb-btn sm', onClick: () => set('goalStaleDays', Math.min(30, Number(form.goalStaleDays || 3) + 1)) }, '＋')),
                h('span', { className: 'wb-small wb-muted' }, '天（1–30）')))),
          section('杠杆', '每天 2–4 个能推动目标的待办；AI 只给候选，确认后才写入。',
            srow('完成动效', '完成杠杆时播放一个轻量动画', h(Switch, {
              checked: form.leverAnimation !== false, label: '完成动效', onChange: (value) => set('leverAnimation', value),
            })),
            srow('早安只推杠杆', '关闭后早安通知还会列出当天待办', h(Switch, {
              checked: form.leverMorningOnly !== false, label: '早安只推杠杆', onChange: (value) => set('leverMorningOnly', value),
            }))),
          section('隐私', '人生面内容只在本机；工作汇报永远不包含北极星、杠杆和偏航报告。',
            srow('允许 AI 读取一句话愿景和规则', '用于杠杆推荐、偏航建议、目标拆解；反愿景和身份宣言永不发送',
              h(Switch, {
                checked: northStar.shareWithAI === true, label: '允许 AI 读取一句话愿景和规则',
                onChange: (value) => setNorthStar({ shareWithAI: value }),
              })),
            northStar.shareWithAI === true
              ? h('div', { className: 'wb-privacy-preview' },
                h('div', { className: 'wb-hint' }, '将发送给模型的确切内容（不含反愿景与身份宣言）：'),
                h('pre', { className: 'wb-privacy-text' }, sharePreview ?? '读取中…'))
              : null,
            srow('北极星防窥遮挡', '打开北极星页和目标页时默认模糊显示，点击才显示',
              h(Switch, {
                checked: northStar.blur !== false, label: '北极星防窥遮挡',
                onChange: (value) => setNorthStar({ blur: value }),
              })),
            h('div', { className: 'wb-privacy-note' }, '团队 / 上级周报永远不会包含北极星、杠杆、偏航报告，这一条没有开关。')),
          section('地区与时间', '影响天气、时钟和时区。插件里的日期、时间、提醒和「今天吃什么」都按这里的城市时区计算。',
            (() => {
              const regionValue = form.region || form.weatherCity || ''
              const regionTz = tzForRegion(regionValue)
              const previewTz = regionTz || (regionValue ? systemTz() : (form.timezone || currentTz()))
              const localNow = formatDateTimeInZone(nowTick, previewTz)
              return srow('地区', `当前生效：${regionValue || '未设置'}${regionValue && !regionTz ? '（未识别城市，暂用系统时区）' : ''}`,
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' } },
                  h(React.Fragment, null,
                    h('input', {
                      className: 'wb-input', style: { maxWidth: 240 }, list: 'wb-city-list',
                      value: regionValue, placeholder: '选择或输入城市，例如：成都 / 华盛顿',
                      onChange: (event) => {
                        const value = event.target.value
                        setForm((current) => ({ ...current, region: value, weatherCity: value, timezone: tzForRegion(value) }))
                        setDirty(true)
                      },
                    }),
                    h('datalist', { id: 'wb-city-list' }, CITY_NAMES.map((city) => h('option', { key: city, value: city })))),
                  h('div', { className: 'wb-hint', style: { textAlign: 'right' } },
                    `时区：${previewTz || '跟随系统'}${previewTz ? `（${tzLongName(previewTz)}）` : ''}`),
                  h('div', { className: 'wb-hint', style: { textAlign: 'right' } },
                    `当地：${localNow}`)))
            })(),
            srow('显示天气', '在今日页顶部显示', h(Switch, {
              checked: form.weatherEnabled !== false, label: '显示天气', onChange: (value) => set('weatherEnabled', value),
            }))),
          section('外观', '修改后立即生效，不需要保存。',
            srow('时间显示', null,
              h('div', { className: 'wb-row' },
                h('div', { className: 'wb-seg' },
                  h('button', { className: form.clockFormat !== '12' ? 'on' : '', onClick: () => setAppearance('clockFormat', '24') }, '24 小时制'),
                  h('button', { className: form.clockFormat === '12' ? 'on' : '', onClick: () => setAppearance('clockFormat', '12') }, '12 小时制')),
                h('span', { className: 'wb-small wb-muted' }, '显示秒'),
                h(Switch, { checked: form.clockSeconds === true, label: '显示秒', onChange: (value) => setAppearance('clockSeconds', value) }))),
            srow('主题', null,
              h('div', { className: 'wb-row' },
                h('select', { className: 'wb-select', style: { maxWidth: 180 }, value: theme, onChange: (event) => setAppearance('themeMode', event.target.value) },
                  [['host', '跟随 DSH（自动）'], ['light', '固定浅色'], ['dark', '固定暗色'], ['time', '按时间自动']].map(([value, label]) => h('option', { key: value, value }, label))),
                form.themeMode === 'time' ? h(React.Fragment, null,
                  h('span', { className: 'wb-small wb-muted' }, '浅色时段'),
                  h('input', { className: 'wb-input', type: 'time', style: { width: 104 }, value: form.themeLightStart ?? '07:00', onChange: (event) => setAppearance('themeLightStart', event.target.value) }),
                  h('span', { className: 'wb-small wb-muted' }, '—'),
                  h('input', { className: 'wb-input', type: 'time', style: { width: 104 }, value: form.themeLightEnd ?? '19:00', onChange: (event) => setAppearance('themeLightEnd', event.target.value) })) : null))),
          section('节假日', '节假日不提醒；调休上班的周末照常提醒。每行一个日期，格式 YYYY-MM-DD。',
            h('div', { className: 'wb-settings-grid' },
              h('label', { className: 'wb-form-field' }, '节假日',
                h('textarea', { className: 'wb-textarea', rows: 4, value: form.holidaysText, placeholder: '2026-10-01', onChange: (event) => set('holidaysText', event.target.value) })),
              h('label', { className: 'wb-form-field' }, '调休上班',
                h('textarea', { className: 'wb-textarea', rows: 4, value: form.extraText, placeholder: '2026-10-11', onChange: (event) => set('extraText', event.target.value) })))),
          h(QuotesSettings, { key: 'quotes', show, ai }),
          state.debug === true ? h('div', { className: 'wb-card', key: 'debug' },
            h('details', { className: 'wb-adv' },
              h('summary', null, '调试'),
              h('div', { className: 'wb-hint', style: { marginBottom: 6 } }, '不改系统时间，结果记录到 log.md 并标 [测试]。'),
              srow('模拟 9:00 提醒', '马上触发一次早安提醒，看看效果', h('button', { className: 'wb-btn sm', onClick: async () => { try { const r = await request('/debug/morning', { channel: 'auto' }); await refresh(); show(`早安提醒：${r.channel}，${r.count ?? 0} 项`) } catch (e) { show(e.message, 'error') } } }, '执行')),
              srow('模拟 18:00 提醒', '马上触发一次晚报提醒', h('button', { className: 'wb-btn sm', onClick: async () => { try { const r = await request('/debug/evening', { channel: 'auto' }); await refresh(); show(r.skipped ? `晚报：${r.skipped}` : `晚报提醒：${r.channel}`) } catch (e) { show(e.message, 'error') } } }, '执行')),
              srow('检查目标提醒', '检查有没有停滞或有风险的目标', h('button', { className: 'wb-btn sm', onClick: async () => { try { const r = await request('/debug/goal-check', { force: true, channel: 'auto' }); await refresh(); show(`目标检查：${(r.alerts ?? []).length} 条提醒`) } catch (e) { show(e.message, 'error') } } }, '执行')),
              srow('立即检查', '马上跑一遍所有提醒规则', h('button', { className: 'wb-btn sm', onClick: async () => { try { const r = await request('/debug/tick', { force: true }); await refresh(); show(`tick：${JSON.stringify(r).slice(0, 120)}`) } catch (e) { show(e.message, 'error') } } }, '执行')))) : null),
        dirty && dirtyCount
          ? h('div', { className: 'wb-savebar', role: 'status' },
            h('span', null, `有 ${dirtyCount} 项修改未保存`),
            h('div', { className: 'wb-spacer' }),
            h('button', { className: 'wb-btn sm ghost', onClick: reset }, '放弃修改'),
            h('button', { className: 'wb-btn sm primary', onClick: save }, '保存设置'))
          : null,
      )
    }

    function WorkBuddyPanel() {
      const [tab, setTab] = useState('today')
      const [state, setState] = useState(null)
      const [suggestions, setSuggestions] = useState([])
      const [error, setError] = useState('')
      const [notice, setNotice] = useState(null)
      const [toast, show, setToastPaused, dismissToast] = useToast()
      const stateRef = useRef(null)
      const snoozeRef = useRef(null)

      useEffect(() => {
        const onNotice = (event) => setNotice(event?.detail ?? null)
        window.addEventListener('zhixing:notice', onNotice)
        return () => window.removeEventListener('zhixing:notice', onNotice)
      }, [])

      const clearSnooze = useCallback((clearStorage = true) => {
        if (snoozeRef.current?.timer) clearTimeout(snoozeRef.current.timer)
        snoozeRef.current = null
        if (clearStorage) {
          try { window.localStorage?.removeItem(SNOOZE_STORAGE_KEY) } catch { /* 忽略 */ }
        }
      }, [])
      const armSnooze = useCallback((value, until) => {
        if (!value || !Number.isFinite(until)) return
        if (snoozeRef.current?.timer) clearTimeout(snoozeRef.current.timer)
        const timer = setTimeout(() => {
          snoozeRef.current = null
          try { window.localStorage?.removeItem(SNOOZE_STORAGE_KEY) } catch { /* 忽略 */ }
          setNotice(value)
        }, Math.max(0, until - Date.now()))
        snoozeRef.current = { timer, notice: value, until }
      }, [])
      const snoozeNotice = (label) => {
        const current = notice
        if (!current) return
        if (label === '明天上班时') {
          setNotice(null)
          show('好的，明天上班时再提醒你', 'ok', () => setNotice(current))
          return
        }
        const minutes = label === '1 小时后' ? 60 : 30
        const until = Date.now() + minutes * 60_000
        clearSnooze()
        setNotice(null)
        armSnooze(current, until)
        try {
          window.localStorage?.setItem(SNOOZE_STORAGE_KEY, JSON.stringify({ until, date: todayKey(), notice: current }))
        } catch { /* 忽略 */ }
        show(`好的，${label}再提醒你`, 'ok', () => { clearSnooze(); setNotice(current) })
      }
      useEffect(() => {
        if (typeof window === 'undefined') return undefined
        let saved = null
        try { saved = JSON.parse(window.localStorage?.getItem(SNOOZE_STORAGE_KEY) ?? 'null') } catch { saved = null }
        if (saved?.notice && Number.isFinite(saved.until)) {
          if (saved.until <= Date.now()) {
            if (!saved.date || saved.date === todayKey()) setNotice(saved.notice)
            try { window.localStorage?.removeItem(SNOOZE_STORAGE_KEY) } catch { /* 忽略 */ }
          } else if (!saved.date || saved.date === todayKey()) {
            armSnooze(saved.notice, saved.until)
          }
        }
        return () => { if (snoozeRef.current?.timer) clearTimeout(snoozeRef.current.timer) }
      }, [armSnooze])

      const loadSuggestions = useCallback(async () => {
        try { const data = await request('/suggestions'); setSuggestions(data.suggestions ?? []) }
        catch { /* 忽略 */ }
      }, [])

      const refresh = useCallback(async () => {
        try {
          const data = await request('/state')
          setActiveTz(data.timezone || tzForRegion(data.settings?.region || data.settings?.weatherCity))
          DEBUG_ENABLED = data.debug === true
          setState(data)
          stateRef.current = data
          setError('')
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }, [])

      useEffect(() => { void refresh(); void loadSuggestions() }, [refresh, loadSuggestions])

      useEffect(() => {
        const timer = setInterval(() => { void refresh(); void loadSuggestions() }, 30_000)
        const goto = (event) => { const next = event?.detail?.tab; if (next) setTab(next) }
        window.addEventListener('zhixing:goto', goto)
        return () => { clearInterval(timer); window.removeEventListener('zhixing:goto', goto) }
      }, [refresh, loadSuggestions])

      const applySuggestion = async (item) => {
        try {
          await request('/suggestions/apply', { id: item.id })
          await refresh(); await loadSuggestions()
          show(`已采纳：${item.goalTitle} → ${item.to}%`, 'ok', async () => {
            try {
              await request('/goals/progress', { id: item.goalId, progress: item.from, reason: '撤销采纳 AI 进度建议' })
              await refresh(); await loadSuggestions()
              show('已撤销，进度已回到原值')
            } catch (error) { show(error.message, 'error') }
          })
        } catch (e) { show(e.message, 'error') }
      }

      const dismissSuggestion = async (item) => {
        try {
          await request('/suggestions/dismiss', { id: item.id })
          await loadSuggestions()
          show('已忽略这条建议')
        } catch (e) { show(e.message, 'error') }
      }

      useEffect(() => {
        let alive = true
        const beat = async () => {
          try {
            const data = await request('/heartbeat', {
              visible: typeof document === 'undefined' ? true : document.visibilityState === 'visible',
              tab,
            })
            if (!alive) return
            const notices = data.notices ?? []
            if (notices.length) {
              for (const notice of notices) {
                try {
                  if (typeof Notification !== 'undefined') {
                    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
                    if (Notification.permission === 'granted') {
                      const native = new Notification(notice.title, { body: notice.body, tag: notice.id })
                      native.onclick = () => {
                        window.focus()
                        window.dispatchEvent(new CustomEvent('zhixing:goto', { detail: { tab: 'today' } }))
                        window.dispatchEvent(new CustomEvent('zhixing:notice', { detail: { kind: notice.kind, title: notice.title, body: notice.body } }))
                        native.close()
                      }
                    }
                  }
                } catch { /* 通知不可用就只留页面提示 */ }
                show(`${notice.title}：${notice.body}`)
                // 晚报提醒要直接变成可操作的卡片（不依赖用户点系统通知）。
                if (notice.kind === 'evening') setNotice({ kind: notice.kind, title: notice.title, body: notice.body })
              }
              await request('/notice-ack', { ids: notices.map((notice) => notice.id) })
              await refresh()
            }
          } catch { /* 心跳失败不影响页面 */ }
        }
        void beat()
        const timer = setInterval(() => { void beat() }, 20_000)
        return () => { alive = false; clearInterval(timer) }
      }, [tab, refresh, show])

      const theme = useTheme(state?.settings)
      const palette = theme === 'dark' ? WB_DARK_VARS : WB_LIGHT_VARS
      return h('div', { className: 'wb-root', 'data-wb-theme': theme, style: { ...palette } },
        h(WbStyles),
        h('div', { className: 'wb-head' },
          h('div', { className: 'wb-title' }, '知行'),
          h('div', { className: 'wb-tabs' },
            ['today', 'reports', 'goals', 'northstar', 'settings'].map((key) => h('button', {
              key, className: `wb-tab${tab === key ? ' active' : ''}`,
              onClick: () => setTab(key),
            }, { today: '今日', reports: '日报', goals: '目标', northstar: '北极星 🔒', settings: '设置' }[key])),
          ),
          h('div', { className: 'wb-spacer' }),
          state ? h(ModelPicker, { state, refresh, show }) : null,
          state ? h('div', { className: 'wb-small wb-muted' }, state.date) : null,
        ),
        toast ? h('div', {
          className: `wb-toast${toast.kind === 'error' ? ' error' : ''}`,
          onMouseEnter: () => setToastPaused(true),
          onMouseLeave: () => setToastPaused(false),
          role: 'status', 'aria-live': 'polite',
        },
          h('span', { style: { flex: 1 } }, toast.text),
          toast.undo ? h('button', {
            className: 'wb-toast-act', onClick: async () => {
              dismissToast()
              try { await toast.undo() } catch (cause) { show(cause.message, 'error') }
            },
          }, '撤销') : null,
          h('button', { className: 'wb-toast-close', 'aria-label': '关闭提示', title: '关闭提示', onClick: dismissToast }, '×'),
          h('div', { className: 'wb-toast-bar', style: { width: `${Math.round(toast.progress * 100)}%` } })) : null,
        error ? h('div', { className: 'wb-toast error' }, error) : null,
        state && state.ai && state.ai.available === false
          ? h('div', { className: 'wb-ai-off', role: 'alert' },
            h('div', { style: { flex: 1 } },
              h('b', null, 'AI 暂时不可用'), '　',
              `${state.ai.reason || '当前模型没有响应'}。拆解、生成日报、进度评估、名句推荐会暂停；你写的内容会保留，恢复后可以继续。`),
            h('button', { className: 'wb-btn sm', onClick: () => document.querySelector('.wb-model-btn')?.click() }, '换一个模型'),
            h('button', { className: 'wb-btn sm', onClick: () => { void refresh() } }, '重试'))
          : null,
        h('div', { className: `wb-body${tab === 'today' ? ' wb-body-fill' : ''}` },
          !state
            ? (error
              ? h(EmptyState, { title: '数据没加载出来', text: '可能是插件服务刚重启。', action: h('button', { className: 'wb-btn primary sm', onClick: () => { void refresh() } }, '重试') })
              : h('div', { className: 'wb-card' }, h(Skeleton, { rows: 5 })))
            : tab === 'today' ? h(TodayTab, {
              state, refresh, show, suggestions, onApplySuggestion: applySuggestion, onDismissSuggestion: dismissSuggestion,
              notice, onCloseNotice: () => setNotice(null), onSnoozeNotice: snoozeNotice,
            })
            : tab === 'reports' ? h(ReportsTab, { state, show })
            : tab === 'goals' ? h(GoalsTab, {
              refreshState: refresh, show, suggestions, ai: state.ai, settings: state.settings,
              onApplySuggestion: applySuggestion, onDismissSuggestion: dismissSuggestion,
              onOpenNorthStar: () => setTab('northstar'),
            })
            : tab === 'northstar' ? h(NorthStarTab, { state, show, onOpenSettings: () => setTab('settings') })
            : h(SettingsTab, { state, refresh, show, ai: state.ai }),
        ),
      )
    }

    function SidebarIcon({ size = 18 }) {
      return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 4.2, y: 3.4, width: 15.6, height: 17.2, rx: 3, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', { d: 'M8.4 8.2h7.2M8.4 12h7.2M8.4 15.8h4.4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('path', { d: 'M9.2 3.4V2.4M14.8 3.4V2.4', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          window.addEventListener('error', (event) => reportClientError(event.error ?? event.message))
          window.addEventListener('unhandledrejection', (event) => reportClientError(event.reason))
        } catch { /* 忽略 */ }
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: PANEL_ID,
        }, WorkBuddyRoot)), 'zhixing: main page')
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_ID, order: 35, label: '知行',
        }, SidebarIcon)), 'zhixing: sidebar')
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'zhixing.quick-todo', order: 85,
        }, QuickTodoLayer)), 'zhixing: selection layer')
        ctx.effect(() => ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
          name: 'conversation.chat.assistant-actions', id: 'zhixing.save-todo', order: 62,
        }, AssistantTodoAction)), 'zhixing: assistant action')
      },
    }
  },
})
