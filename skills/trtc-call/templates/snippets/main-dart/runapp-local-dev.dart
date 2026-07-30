// ⚠️ 仅本地调试。生产必须由后端签发 UserSig，SecretKey 严禁打包进客户端。
// 使用 --dart-define 注入本地凭证，禁止把 SecretKey 写入源码或提交到版本库。
const trtcSdkAppId = int.fromEnvironment('TRTC_SDK_APP_ID');
const trtcSecretKey = String.fromEnvironment('TRTC_SECRET_KEY');
GenerateTestUserSig.sdkAppId = trtcSdkAppId;
GenerateTestUserSig.secretKey = trtcSecretKey;
TrtcCallBootstrap.run(
  sdkAppId: trtcSdkAppId,
  builder: (trtcDelegates, trtcObservers) => MyApp(
    trtcDelegates: trtcDelegates,
    trtcObservers: trtcObservers,
  ),
);
