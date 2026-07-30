// TODO: 替换为你的 SDKAppID（腾讯云控制台 → TRTC → 应用管理）
TrtcCallBootstrap.run(
  sdkAppId: __SDK_APP_ID__,
  builder: (trtcDelegates, trtcObservers) => MyApp(
    trtcDelegates: trtcDelegates,
    trtcObservers: trtcObservers,
  ),
);
