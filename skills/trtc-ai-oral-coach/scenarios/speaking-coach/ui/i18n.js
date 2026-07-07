// ===================================================================
// LinguaCoach AI Speaking Coach — 多语言文案
//   场景/风格/语速/音色/技能 按语言切换
// ===================================================================
'use strict';

window.I18N_DATA = {
  'zh-CN':{
    scenes:{
      travel:{title:'机场登机',sub:'值机 · 安检 · 登机口',desc:'国际机场办理值机、托运行李、过安检的常用对话。',
        aiRoles:[{n:'Sarah',r:'地勤'}], meRoles:[{n:'乘客',r:'独自'}],
        recommendedExpressions:[
          {en:'boarding pass',zh:'登机牌'},{en:'baggage allowance',zh:'行李额'},
          {en:'window or aisle',zh:'靠窗/过道'},{en:'gate change',zh:'登机口变动'}
        ]},
      work:{title:'项目周会',sub:'进度同步 · 异议处理',desc:'每周项目同步会议，简报进展、提出风险、讨论行动项。',
        aiRoles:[{n:'Anna',r:'产品经理'}], meRoles:[{n:'工程师',r:'后端'}],
        recommendedExpressions:[
          {en:'on track',zh:'按计划进行'},{en:'blocker',zh:'阻塞项'},
          {en:'action item',zh:'待办事项'},{en:'follow up',zh:'跟进'}
        ]},
      daily:{title:'咖啡店点单',sub:'日常 · 闲聊',desc:'本地咖啡店点单、问推荐、和店员小寒暄。',
        aiRoles:[{n:'Emma',r:'咖啡师'}], meRoles:[{n:'顾客',r:'第一次'}],
        recommendedExpressions:[
          {en:'for here or to go',zh:'堂食还是外带'},{en:'can I get ...',zh:'我要一份...'},
          {en:'what do you recommend',zh:'你有什么推荐'},{en:'make it less sweet',zh:'少糖'}
        ]},
      free:{title:'自由聊天',sub:'无主题 · 随兴',desc:'没有预设场景，让对话自然流动。',
        aiRoles:[{n:'Luna',r:'好友'}], meRoles:[{n:'自己',r:'本色'}],
        recommendedExpressions:[
          {en:'by the way',zh:'顺便一提'},{en:'speaking of which',zh:'说到这个'},
          {en:"I'm curious about",zh:'我很好奇'},{en:"what's your take",zh:'你怎么看'}
        ]}
    },
    styles:{friend:{label:'闲聊朋友',desc:'口语、缩写、轻松随意。保持轻松友好的聊天氛围。'},listen:{label:'积极听众',desc:'多倾听追问，鼓励多说。主动问跟进问题让对话不断延伸。'},local:{label:'地道当地人',desc:'本地表达、俚语和文化梗。自然地使用地道短语和习惯用语。'}},
    difficulties:{a:{label:'舒缓',desc:'语速放慢，留足思考时间，词汇 A1–A2、句子简短。话题浅显易懂。'},b:{label:'自然',desc:'接近日常交流的语速，词汇 B1–B2，话题深度中等。'},c:{label:'流畅',desc:'语速接近母语者，词汇 C1+，话题可以深入探讨，挑战听力反应。'}},
    voices:{f:{label:'女声'},m:{label:'男声'}},
    summary:{scene:'场景',ai:'AI',me:'我',pace:'语速',voice:'音色'},
    skills:{fluency:{label:'流利度'}, vocab:{label:'词汇'}, grammar:{label:'语法'}, completeness:{label:'完整度'}},
    suggestTitle:'建议优化',suggestFix:'更地道的说法：'
  },
  'zh-TW':{
    scenes:{
      travel:{title:'機場登機',sub:'報到 · 安檢 · 登機口',desc:'國際機場辦理報到、託運行李、過安檢的常用對話。',
        aiRoles:[{n:'Sarah',r:'地勤'}], meRoles:[{n:'乘客',r:'獨自'}],
        recommendedExpressions:[
          {en:'boarding pass',zh:'登機證'},{en:'baggage allowance',zh:'行李額度'},
          {en:'window or aisle',zh:'靠窗/走道'},{en:'gate change',zh:'登機口異動'}
        ]},
      work:{title:'專案週會',sub:'進度同步 · 異議處理',desc:'每週專案同步會議，簡報進展、提出風險、討論行動項。',
        aiRoles:[{n:'Anna',r:'產品經理'}], meRoles:[{n:'工程師',r:'後端'}],
        recommendedExpressions:[
          {en:'on track',zh:'按計畫進行'},{en:'blocker',zh:'阻塞項'},
          {en:'action item',zh:'待辦事項'},{en:'follow up',zh:'追蹤'}
        ]},
      daily:{title:'咖啡店點單',sub:'日常 · 閒聊',desc:'本地咖啡店點單、詢問推薦、和店員小寒暄。',
        aiRoles:[{n:'Emma',r:'咖啡師'}], meRoles:[{n:'顧客',r:'第一次'}],
        recommendedExpressions:[
          {en:'for here or to go',zh:'內用還是外帶'},{en:'can I get ...',zh:'我要一份...'},
          {en:'what do you recommend',zh:'有什麼推薦'},{en:'make it less sweet',zh:'少糖'}
        ]},
      free:{title:'自由聊天',sub:'無主題 · 隨興',desc:'沒有預設場景，讓對話自然流動。',
        aiRoles:[{n:'Luna',r:'好友'}], meRoles:[{n:'自己',r:'本色'}],
        recommendedExpressions:[
          {en:'by the way',zh:'順便一提'},{en:'speaking of which',zh:'說到這個'},
          {en:"I'm curious about",zh:'我很好奇'},{en:"what's your take",zh:'你怎麼看'}
        ]}
    },
    styles:{friend:{label:'閒聊朋友',desc:'口語、縮寫、輕鬆隨意。'},listen:{label:'積極聽眾',desc:'多傾聽追問，鼓勵多說。'},local:{label:'道地當地人',desc:'本地表達、俚語和文化梗。'}},
    difficulties:{a:{label:'舒緩',desc:'語速放慢，留足思考時間，詞彙 A1–A2、句子簡短。'},b:{label:'自然',desc:'接近日常交流的語速，詞彙 B1–B2，話題深度中等。'},c:{label:'流暢',desc:'語速接近母語者，詞彙 C1+，挑戰聽力反應。'}},
    voices:{f:{label:'女聲'},m:{label:'男聲'}},
    summary:{scene:'場景',ai:'AI',me:'我',pace:'語速',voice:'音色'},
    skills:{fluency:{label:'流利度'},vocab:{label:'詞彙'},grammar:{label:'文法'},completeness:{label:'完整度'}},
    suggestTitle:'建議優化',suggestFix:'更道地的說法：'
  },
  'en':{
    scenes:{
      travel:{title:'Airport Check-in',sub:'Check-in · Security · Gate',desc:'Common dialogues for check-in, baggage drop and security at an international airport.',
        aiRoles:[{n:'Sarah',r:'Ground staff'}], meRoles:[{n:'Passenger',r:'Solo'}],
        recommendedExpressions:[
          {en:'boarding pass',zh:'登机牌 / boarding pass'},{en:'baggage allowance',zh:'行李额 / baggage allowance'},
          {en:'window or aisle',zh:'靠窗或过道 / window or aisle'},{en:'gate change',zh:'登机口变动 / gate change'}
        ]},
      work:{title:'Project Weekly',sub:'Status sync · Pushback',desc:'Weekly sync meeting — share progress, flag risks, agree on action items.',
        aiRoles:[{n:'Anna',r:'Product manager'}], meRoles:[{n:'Engineer',r:'Backend'}],
        recommendedExpressions:[
          {en:'on track',zh:'按计划进行 / on track'},{en:'blocker',zh:'阻塞项 / blocker'},
          {en:'action item',zh:'待办事项 / action item'},{en:'follow up',zh:'跟进 / follow up'}
        ]},
      daily:{title:'Coffee Shop Order',sub:'Daily · Small talk',desc:'Order at a local coffee shop, ask for recommendations, chat with the barista.',
        aiRoles:[{n:'Emma',r:'Barista'}], meRoles:[{n:'Customer',r:'First time'}],
        recommendedExpressions:[
          {en:'for here or to go',zh:'堂食还是外带 / for here or to go'},{en:'can I get ...',zh:'我要一份 / can I get ...'},
          {en:'what do you recommend',zh:'你有什么推荐 / what do you recommend'},{en:'make it less sweet',zh:'少糖 / make it less sweet'}
        ]},
      free:{title:'Free Chat',sub:'No topic · Just chat',desc:'No preset scene — let the conversation flow naturally.',
        aiRoles:[{n:'Luna',r:'Friend'}], meRoles:[{n:'Yourself',r:'As is'}],
        recommendedExpressions:[
          {en:'by the way',zh:'顺便一提 / by the way'},{en:'speaking of which',zh:'说到这个 / speaking of which'},
          {en:"I'm curious about",zh:'我很好奇 / I am curious about'},{en:"what's your take",zh:'你怎么看 / what is your take'}
        ]}
    },
    styles:{friend:{label:'Casual friend',desc:'Spoken style, contractions, easygoing.'},listen:{label:'Active listener',desc:'Listens and asks follow-ups to encourage you.'},local:{label:'Local native',desc:'Local phrasing, slang and cultural references.'}},
    difficulties:{a:{label:'Easy',desc:'Slower pace, lots of think time, A1–A2 vocab, short sentences.'},b:{label:'Natural',desc:'Everyday conversational pace, B1–B2 vocab, medium depth.'},c:{label:'Fluent',desc:'Near-native pace, C1+ vocab — a listening challenge.'}},
    voices:{f:{label:'Female'},m:{label:'Male'}},
    summary:{scene:'Scene',ai:'AI',me:'You',pace:'Pace',voice:'Voice'},
    skills:{fluency:{label:'Fluency'},vocab:{label:'Vocabulary'},grammar:{label:'Grammar'},completeness:{label:'Completeness'}},
    suggestTitle:'Suggested rewrite',suggestFix:'More natural:'
  },
  'ja':{
    scenes:{
      travel:{title:'空港チェックイン',sub:'チェックイン · 保安検査 · 搭乗口',desc:'国際空港でのチェックイン、手荷物預け、保安検査の定番会話。',
        aiRoles:[{n:'Sarah',r:'地上係員'}], meRoles:[{n:'乗客',r:'一人旅'}],
        recommendedExpressions:[
          {en:'boarding pass',zh:'搭乗券'},{en:'baggage allowance',zh:'手荷物許容量'},
          {en:'window or aisle',zh:'窓側か通路側'},{en:'gate change',zh:'搭乗口変更'}
        ]},
      work:{title:'プロジェクト週次会議',sub:'進捗共有 · 異議対応',desc:'毎週の進捗会議：進展報告、リスク提起、アクション合意。',
        aiRoles:[{n:'Anna',r:'PM'}], meRoles:[{n:'エンジニア',r:'バックエンド'}],
        recommendedExpressions:[
          {en:'on track',zh:'予定通り'},{en:'blocker',zh:'ブロッカー'},
          {en:'action item',zh:'アクションアイテム'},{en:'follow up',zh:'フォローアップ'}
        ]},
      daily:{title:'カフェで注文',sub:'日常 · 雑談',desc:'地元のカフェで注文、おすすめを聞く、店員と軽く雑談。',
        aiRoles:[{n:'Emma',r:'バリスタ'}], meRoles:[{n:'お客',r:'初めて'}],
        recommendedExpressions:[
          {en:'for here or to go',zh:'店内か持ち帰り'},{en:'can I get ...',zh:'〜をください'},
          {en:'what do you recommend',zh:'おすすめは何？'},{en:'make it less sweet',zh:'甘さ控えめで'}
        ]},
      free:{title:'フリートーク',sub:'テーマなし · 気ままに',desc:'設定なしで、会話を自然に流すスタイル。',
        aiRoles:[{n:'Luna',r:'友達'}], meRoles:[{n:'自分',r:'素のまま'}],
        recommendedExpressions:[
          {en:'by the way',zh:'ところで'},{en:'speaking of which',zh:'そういえば'},
          {en:"I'm curious about",zh:'〜に興味がある'},{en:"what's your take",zh:'你怎么看？'}
        ]}
    },
    styles:{friend:{label:'気軽な友達',desc:'口語、省略形、リラックス。'},listen:{label:'聞き上手',desc:'聞いて掘り下げ、たくさん話してもらう。'},local:{label:'ネイティブ風',desc:'地元の表現、スラング。'}},
    difficulties:{a:{label:'ゆっくり',desc:'話す速度を落とし、考える時間も多め。語彙 A1–A2、短い文。'},b:{label:'自然',desc:'日常会話に近い速度。語彙 B1–B2、内容は中程度。'},c:{label:'流暢',desc:'ネイティブ並みの速度、語彙 C1+。'}},
    voices:{f:{label:'女性'},m:{label:'男性'}},
    summary:{scene:'シーン',ai:'AI',me:'あなた',pace:'速さ',voice:'声'},
    skills:{fluency:{label:'流暢さ'},vocab:{label:'語彙'},grammar:{label:'文法'},completeness:{label:'完結度'}},
    suggestTitle:'改善の提案',suggestFix:'より自然な言い方：'
  },
  'ko':{
    scenes:{
      travel:{title:'공항 체크인',sub:'체크인 · 보안 · 탑승구',desc:'국제공항에서의 체크인, 수하물 위탁, 보안 검색.',
        aiRoles:[{n:'Sarah',r:'지상 직원'}], meRoles:[{n:'승객',r:'혼자'}],
        recommendedExpressions:[
          {en:'boarding pass',zh:'탑승권'},{en:'baggage allowance',zh:'수하물 허용량'},
          {en:'window or aisle',zh:'창측 또는 복도측'},{en:'gate change',zh:'탑승구 변경'}
        ]},
      work:{title:'프로젝트 주간 회의',sub:'진행 공유 · 이견 조율',desc:'주간 동기화 회의: 진행 보고, 리스크 제기, 액션 아이템 합의.',
        aiRoles:[{n:'Anna',r:'PM'}], meRoles:[{n:'엔지니어',r:'백엔드'}],
        recommendedExpressions:[
          {en:'on track',zh:'순조롭게 진행 중'},{en:'blocker',zh:'블로커'},
          {en:'action item',zh:'액션 아이템'},{en:'follow up',zh:'팔로업'}
        ]},
      daily:{title:'카페 주문',sub:'일상 · 잡담',desc:'동네 카페에서 주문하고 추천을 묻고 직원과 잠시 잡담.',
        aiRoles:[{n:'Emma',r:'바리스타'}], meRoles:[{n:'손님',r:'첫 방문'}],
        recommendedExpressions:[
          {en:'for here or to go',zh:'매장 or 포장'},{en:'can I get ...',zh:'... 주세요'},
          {en:'what do you recommend',zh:'추천 메뉴가 있나요?'},{en:'make it less sweet',zh:'덜 달게 해주세요'}
        ]},
      free:{title:'자유 대화',sub:'주제 없음 · 자유롭게',desc:'설정된 장면 없이 대화가 자연스럽게 흐르도록.',
        aiRoles:[{n:'Luna',r:'친구'}], meRoles:[{n:'나',r:'있는 그대로'}],
        recommendedExpressions:[
          {en:'by the way',zh:'참고로'},{en:'speaking of which',zh:'말이 나와서 말인데'},
          {en:"I'm curious about",zh:'~에 대해 궁금해'},{en:"what's your take",zh:'너는 어떻게 생각해?'}
        ]}
    },
    styles:{friend:{label:'편한 친구',desc:'구어체, 축약, 가볍고 자유롭게.'},listen:{label:'적극적 청자',desc:'경청하고 되묻기로 더 말하게.'},local:{label:'토박이 현지인',desc:'현지 표현, 슬랭.'}},
    difficulties:{a:{label:'여유',desc:'천천히, 생각할 시간 충분, 어휘 A1–A2, 짧은 문장.'},b:{label:'자연스럽게',desc:'일상 대화 속도, 어휘 B1–B2, 중간 깊이.'},c:{label:'유창하게',desc:'원어민에 가까운 속도, 어휘 C1+.'}},
    voices:{f:{label:'여성'},m:{label:'남성'}},
    summary:{scene:'상황',ai:'AI',me:'나',pace:'속도',voice:'음색'},
    skills:{fluency:{label:'유창성'},vocab:{label:'어휘'},grammar:{label:'문법'},completeness:{label:'완결성'}},
    suggestTitle:'개선 제안',suggestFix:'더 자연스러운 표현:'
  }
};

window.I18N = {
  'zh-CN':{
    'setup.eyebrow':'START A NEW SESSION','setup.title':'让对话开始','setup.subtitle':'选一个场景，就能立刻和 Lumen 开始练习。',
    'setup.scenesTitle':'场景','setup.aiPlays':'AI 扮演','setup.iPlay':'我扮演','setup.more':'更多设置','setup.moreHint':'语速 · 音色 · 语言','setup.done':'完成',
    'setup.phrasesTitle':'场景推荐表达',
    'pref.style':'交流风格','pref.pace':'语速','pref.voice':'音色','pref.lang':'界面语言',
    'btn.startChat':'开始对话',
    'practice.start':'开始对话','practice.stop':'结束说话',
    'practice.stateReady':'Ready · 点击下方按钮开始对话','practice.stateRecording':'Recording…','practice.stateSpeaking':'AI Speaking…',
    'practice.captionReady':'准备好了就开始说话吧',
    'practice.needHint':'需要一些灵感？','practice.suggested':'建议回复',
    'practice.subtitle':'实时字幕','practice.subtitleSub':'对话同步显示 · 语法即时建议','practice.end':'结束练习',
    'practice.statusIdle':'未在录音 · 点击"开始对话"开始','practice.statusRecording':'正在录音 · 说完后再次点击按钮','practice.statusAI':'AI 正在回复…','practice.statusTurn':'轮到你了 · 点击"开始对话"开始说话','practice.statusConnecting':'连接中…',
    'practice.captionRecording':'AI 教练正在听你说话','practice.captionWaiting':'AI 教练正在等你回复','practice.captionThinking':'AI 教练正在思考…',
    'report.eyebrow':'练习已完成','report.title':'干得漂亮！','report.subtitle':'会话已完成，来看看你的表现如何。',
    'report.duration':'练习时长','report.turns':'对话轮次','report.coach':'AI 教练评语','report.coachSub':'Lumen 给你的话','report.skill':'能力分析',
    'report.transcriptTitle':'完整对话回顾','report.transcriptLabel':'对话记录',
    'report.back':'返回配置','report.again':'再来一轮',
    'loading.generating':'AI 正在整理你的口语报告，请稍候…','lang.label':'简体中文'
  },
  'zh-TW':{
    'setup.eyebrow':'START A NEW SESSION','setup.title':'讓對話開始','setup.subtitle':'選一個場景，就能立刻和 Lumen 開始練習。',
    'setup.scenesTitle':'場景','setup.aiPlays':'AI 扮演','setup.iPlay':'我扮演','setup.more':'更多設定','setup.moreHint':'語速 · 音色 · 語言','setup.done':'完成',
    'setup.phrasesTitle':'場景推薦表達',
    'pref.style':'交流風格','pref.pace':'語速','pref.voice':'音色','pref.lang':'介面語言',
    'btn.startChat':'開始對話',
    'practice.start':'開始對話','practice.stop':'結束說話',
    'practice.stateReady':'Ready · 點擊下方按鈕開始對話','practice.stateRecording':'Recording…','practice.stateSpeaking':'AI Speaking…',
    'practice.captionReady':'準備好了就開始說話吧',
    'practice.needHint':'需要一些靈感？','practice.suggested':'建議回覆',
    'practice.subtitle':'即時字幕','practice.subtitleSub':'對話同步顯示 · 文法即時建議','practice.end':'結束練習',
    'practice.statusIdle':'未在錄音 · 點擊「開始對話」開始','practice.statusRecording':'正在錄音 · 說完後再次點擊按鈕','practice.statusAI':'AI 正在回覆…','practice.statusTurn':'輪到你了 · 點擊「開始對話」開始說話','practice.statusConnecting':'連接中…',
    'practice.captionRecording':'AI 教練正在聽你說話','practice.captionWaiting':'AI 教練正在等你回覆','practice.captionThinking':'AI 教練正在思考…',
    'report.eyebrow':'練習已完成','report.title':'幹得漂亮！','report.subtitle':'會話已完成，來看看你的表現如何。',
    'report.duration':'練習時長','report.turns':'對話輪次','report.coach':'AI 教練評語','report.coachSub':'Lumen 給你的話','report.skill':'能力分析',
    'report.transcriptTitle':'完整對話回顧','report.transcriptLabel':'對話記錄',
    'report.back':'返回設定','report.again':'再來一輪',
    'loading.generating':'AI 正在整理你的口語報告，請稍候…','lang.label':'繁體中文'
  },
  'en':{
    'setup.eyebrow':'START A NEW SESSION','setup.title':"Let's start talking",'setup.subtitle':'Choose a scene and start practicing with Lumen right away.',
    'setup.scenesTitle':'Scenes','setup.aiPlays':'AI plays as','setup.iPlay':'I play as','setup.more':'More settings','setup.moreHint':'Pace · Voice · Language','setup.done':'Done',
    'setup.phrasesTitle':'Recommended phrases',
    'pref.style':'Style','pref.pace':'Pace','pref.voice':'Voice','pref.lang':'Language',
    'btn.startChat':'Start chatting',
    'practice.start':'Start talking','practice.stop':'Stop talking',
    'practice.stateReady':'Ready · tap below to start','practice.stateRecording':'Recording…','practice.stateSpeaking':'AI Speaking…',
    'practice.captionReady':"Whenever you're ready, start talking",
    'practice.needHint':'Need some inspiration?','practice.suggested':'SUGGESTED REPLIES',
    'practice.subtitle':'Live transcript','practice.subtitleSub':'Real-time conversation · instant grammar tips','practice.end':'End practice',
    'practice.statusIdle':'Not recording · tap "Start talking" to begin','practice.statusRecording':'Recording · tap again when done','practice.statusAI':'AI is replying…','practice.statusTurn':'Your turn · tap "Start talking"','practice.statusConnecting':'Connecting…',
    'practice.captionRecording':'AI coach is listening to you','practice.captionWaiting':'AI coach is waiting for you','practice.captionThinking':'AI coach is thinking…',
    'report.eyebrow':'Session Complete','report.title':'Great Session!','report.subtitle':"Session complete — let's see how you did.",
    'report.duration':'Duration','report.turns':'Turns','report.coach':'AI Coach','report.coachSub':'A note from Lumen','report.skill':'Skill Analysis',
    'report.transcriptTitle':'Full Transcript','report.transcriptLabel':'Transcript',
    'report.back':'Back to setup','report.again':'Practice again',
    'loading.generating':'Generating your speaking report — please wait…','lang.label':'English'
  },
  'ja':{
    'setup.eyebrow':'START A NEW SESSION','setup.title':'会話を始めよう','setup.subtitle':'シーンを選ぶだけで、すぐに Lumen と練習を始められます。',
    'setup.scenesTitle':'シーン','setup.aiPlays':'AI 役','setup.iPlay':'あなたの役','setup.more':'詳細設定','setup.moreHint':'速度 · 声 · 言語','setup.done':'完了',
    'setup.phrasesTitle':'おすすめフレーズ',
    'pref.style':'スタイル','pref.pace':'話す速さ','pref.voice':'声色','pref.lang':'表示言語',
    'btn.startChat':'会話を始める',
    'practice.start':'話し始める','practice.stop':'話し終える',
    'practice.stateReady':'Ready · 下のボタンをタップ','practice.stateRecording':'録音中…','practice.stateSpeaking':'AI が話しています…',
    'practice.captionReady':'準備ができたら話し始めてください',
    'practice.needHint':'ヒントが必要？','practice.suggested':'提案する返信',
    'practice.subtitle':'ライブ字幕','practice.subtitleSub':'会話を同期表示 · 文法を即時アドバイス','practice.end':'練習を終了',
    'practice.statusIdle':'録音していません · 「話し始める」をタップ','practice.statusRecording':'録音中 · 終わったらもう一度タップ','practice.statusAI':'AI が返答中…','practice.statusTurn':'あなたの番です · 「話し始める」をタップ','practice.statusConnecting':'接続中…',
    'practice.captionRecording':'AI コーチがあなたの話を聞いています','practice.captionWaiting':'AI コーチが返信を待っています','practice.captionThinking':'AI コーチが考え中…',
    'report.eyebrow':'セッション完了','report.title':'お疲れ様でした！','report.subtitle':'セッションが完了しました。',
    'report.duration':'練習時間','report.turns':'会話ターン数','report.coach':'AI コーチ','report.coachSub':'Lumen からのメッセージ','report.skill':'能力分析',
    'report.transcriptTitle':'会話の振り返り','report.transcriptLabel':'会話記録',
    'report.back':'設定に戻る','report.again':'もう一度練習',
    'loading.generating':'レポートを生成中です、少々お待ちください…','lang.label':'日本語'
  },
  'ko':{
    'setup.eyebrow':'START A NEW SESSION','setup.title':'대화를 시작해 볼까요','setup.subtitle':'상황 하나만 고르면 바로 Lumen과 연습을 시작할 수 있어요.',
    'setup.scenesTitle':'상황','setup.aiPlays':'AI 역할','setup.iPlay':'내 역할','setup.more':'더 많은 설정','setup.moreHint':'속도 · 음색 · 언어','setup.done':'완료',
    'setup.phrasesTitle':'추천 표현',
    'pref.style':'스타일','pref.pace':'속도','pref.voice':'음색','pref.lang':'인터페이스 언어',
    'btn.startChat':'대화 시작',
    'practice.start':'대화 시작','practice.stop':'말하기 종료',
    'practice.stateReady':'Ready · 아래 버튼을 누르세요','practice.stateRecording':'녹음 중…','practice.stateSpeaking':'AI 가 말하는 중…',
    'practice.captionReady':'준비되면 말씀해 주세요',
    'practice.needHint':'영감이 필요한가요?','practice.suggested':'제안하는 답장',
    'practice.subtitle':'실시간 자막','practice.subtitleSub':'대화 동기화 · 문법 즉시 제안','practice.end':'연습 종료',
    'practice.statusIdle':'녹음 중 아님 · "대화 시작" 을 누르세요','practice.statusRecording':'녹음 중 · 끝나면 다시 누르세요','practice.statusAI':'AI 답변 중…','practice.statusTurn':'당신 차례입니다 · "대화 시작" 을 누르세요','practice.statusConnecting':'연결 중…',
    'practice.captionRecording':'AI 코치가 듣고 있어요','practice.captionWaiting':'AI 코치가 응답을 기다리는 중','practice.captionThinking':'AI 코치가 생각 중…',
    'report.eyebrow':'세션 완료','report.title':'잘 하셨어요!','report.subtitle':'세션이 완료되었습니다.',
    'report.duration':'연습 시간','report.turns':'대화 턴 수','report.coach':'AI 코치','report.coachSub':'Lumen 의 한마디','report.skill':'능력 분석',
    'report.transcriptTitle':'전체 대화 다시보기','report.transcriptLabel':'대화 기록',
    'report.back':'설정으로','report.again':'다시 연습',
    'loading.generating':'AI 가 말하기 레포트를 생성 중입니다, 잠시만 기다려주세요…','lang.label':'한국어'
  }
};

// ===================== i18n runtime =====================
// 默认语言：英文（按 demo 要求）
window.currentLang = 'en';
window.t = function(key){
  const dict = window.I18N[window.currentLang] || window.I18N['en'];
  return dict[key] || window.I18N['en'][key] || key;
};

// 把 I18N_DATA 中的动态文本注入到 appData 上
window.applyDataI18n = function(){
  const D = window.appData; if(!D) return;
  const L = window.I18N_DATA[window.currentLang] || window.I18N_DATA['en'];
  D.scenes.forEach(s=>{
    const x=L.scenes[s.id]; if(x){
      s.title=x.title; s.sub=x.sub; s.desc=x.desc;
      s.aiRoles=x.aiRoles.map(o=>({...o}));
      s.meRoles=x.meRoles.map(o=>({...o}));
      // 推荐表达：随语言切换的翻译版本（zh 模式 → 中文为主，en/ja/ko 模式 → 英文为主）
      if(Array.isArray(x.recommendedExpressions)) s.recommendedExpressions=x.recommendedExpressions;
    }
  });
  D.styles.forEach(s=>{ const x=L.styles[s.id]; if(x){ s.label=x.label; s.desc=x.desc; }});
  D.difficulties.forEach(s=>{ const x=L.difficulties[s.id]; if(x){ s.label=x.label; s.desc=x.desc; }});
  D.voices.forEach(s=>{ const x=L.voices[s.id]; if(x){ s.label=x.label; }});
  Object.keys(D._skillLabels||{}).forEach(k=>{ const x=L.skills[k]; if(x) D._skillLabels[k]=x.label; });
  D._summaryLabels = L.summary;
  D._suggestTitle = L.suggestTitle;
  D._suggestFix   = L.suggestFix;
};

// 批量应用 i18n 到 DOM 元素
window.applyI18n = function(){
  window.applyDataI18n();
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    el.textContent = window.t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el=>{
    el.setAttribute('title', window.t(el.getAttribute('data-i18n-title')));
  });
  if(window.cfgState && window.initConfigView) window.initConfigView();
  var rv = document.getElementById('view-report');
  if(rv && !rv.classList.contains('hidden') && window.renderReport) window.renderReport();
  var pv = document.getElementById('view-practice');
  if(pv && !pv.classList.contains('hidden') && window.refreshPracticeMeta) window.refreshPracticeMeta();
  document.documentElement.lang = window.currentLang;
};
