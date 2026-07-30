// MaterialApp.router 只接入本地化；NavigatorObserver 必须注入 Router 配置。
localizationsDelegates: [...trtcDelegates],
supportedLocales: const [Locale('zh', 'CN'), Locale('en', 'US')],
