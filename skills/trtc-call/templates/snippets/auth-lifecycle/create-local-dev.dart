final CallAuthLifecycle callAuthLifecycle = CallAuthLifecycle(
  userSigProvider: (userId) async => GenerateTestUserSig.genTestSig(userId),
  normalizeUserId: __OPTIONAL_USER_ID_NORMALIZER__,
);
