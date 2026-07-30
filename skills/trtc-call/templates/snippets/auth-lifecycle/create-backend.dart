final CallAuthLifecycle callAuthLifecycle = CallAuthLifecycle(
  userSigProvider: (userId) => __USER_SIG_PROVIDER__(userId),
  normalizeUserId: __OPTIONAL_USER_ID_NORMALIZER__,
);
