// 拼进 MaterialApp / CupertinoApp 的 localizationsDelegates / navigatorObservers 数组：
//   - 用户已有对应数组 → spread 追加：`[...existingItems, ...trtcDelegates]`
//   - 用户无对应参数   → 直接加：`localizationsDelegates: [...trtcDelegates],`
// supportedLocales 若用户未设置，需要一并加上（否则 TUICallKit UI 文案会缺失）。

localizationsDelegates: [...trtcDelegates],
supportedLocales: const [Locale('zh', 'CN'), Locale('en', 'US')],
navigatorObservers: [...trtcObservers],
