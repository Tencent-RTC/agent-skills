# UserSig：调试、编码、错误定位与生产迁移

只有登录/鉴权/新应用联调问题才读取本页，不作为每个UI源码任务的必读文档。账号ID、SDKAppID、UserSig必须同应用同用户。除客户明确要求写入的目标代码外，不在方案、日志摘要或最终回复中重复完整SecretKey、管理员UserSig或用户UserSig。

## 签名来源

1. 生产推荐由客户业务服务端在鉴权后签发用户自己的UserSig。
2. 客户明确选择参考Chat Demo在客户端使用SecretKey调试时，可以按其选择实施：在方案、写入授权前和最终交付时分别说明客户端密钥可被提取，不能把该方式描述为安全的生产方案，并继续推荐服务端签发。登录参数来源的判断与实施步骤见 [应用接入·登录](../app/integration.md#登录)。
3. 客户端调试签名用 [DebugSignature.swift](../examples/DebugSignature.swift)。此模板没有真实密钥、只在DEBUG编译；仅HMAC-SHA256 TLS v2.0，不支持旧ECDSA或带userbuf的特殊签名。SecretKey由客户填入目标文件，不要求客户发到对话里；不要为了调试自动读取现有密钥文件。
4. 验证某个UserSig是否正确时，可用 [IM控制台UserSig生成校验](https://console.cloud.tencent.com/im/tool-usersig) 或官方GenerateTestUserSig对照，不自行猜编码。
5. REST API创建测试账号和消息时使用管理员UserSig；客户端登录使用目标用户自己的UserSig，两者不能混用。

不要为验证签名调用管理员REST接口制造权限失败。生成普通用户签名、管理员签名和目标接收者注册是三个独立问题。

## 精确算法边界

参照 [官方说明](https://cloud.tencent.com/document/product/269/1656) 与 [官方TLSSigAPIv2 Python实现](https://github.com/tencentyun/tls-sig-api-v2-python)。不采用“JSON直接Base64”或标准RFC4648 Base64URL代替腾讯签名格式。

1. 用UTF-8和末尾换行拼接HMAC输入，顺序固定：`TLS.identifier:<userID>\nTLS.sdkappid:<SDKAppID>\nTLS.time:<签发Unix秒>\nTLS.expire:<有效期秒>\n`。expire是持续秒数，不是过期时间戳。
2. HMAC-SHA256使用SecretKey的UTF-8字节；摘要用**普通Base64**成为JSON字段 `TLS.sig`。
3. JSON含 `TLS.ver="2.0"`、`TLS.identifier`、`TLS.sdkappid`、`TLS.time`、`TLS.expire`、`TLS.sig`，序列化成UTF-8。
4. 将整个JSON做 **zlib封装的DEFLATE**，包含zlib头、DEFLATE内容、Adler-32尾部。使用zlib.compress/compress2即可，不再手工叠头尾；raw DEFLATE、gzip与Apple COMPRESSION_ZLIB的输出不能仅凭名字当作相同格式。
5. 压缩字节做普通Base64，再按腾讯规则替换：`+ → *`、`/ → -`、`= → _`。保留替换后的padding；不是常见的 `+ → -`、`/ → _` 再删padding。

zlib头取决于压缩参数，不硬编码 `78 9C` 为所有实现必须使用的头。JSON字段顺序和压缩级别可能使最终签名字符串不同；验证应比较解压字段及HMAC，不能只比整段字符串。

模板以参数传入测试时间，可用固定的虚构密钥与含中文的userID做离线交叉验证。维护者通过 Swift/Python 离线交叉验证检查腾讯Base64替换、标准zlib解压与HMAC结果。测试不登录、不使用真实密钥、不会据此宣称云端鉴权已验证。

## 常见错误码

以 [当前IM错误码表](https://cloud.tencent.com/document/product/269/1671) 和实际返回desc/SDK版本为准：

| 码 | 官方分类/描述 | 排查与边界 |
| --- | --- | --- |
| 70003 | 解析失败 | 先查签名传输是否截断/带引号空白、腾讯Base64替换、zlib封装、JSON与字段类型；不能只归因密钥，普通Base64或漏压缩是重要线索 |
| 70001 | UserSig已过期 | 检查Unix秒、expire单位、设备/服务端时钟与签发时间 |
| 60010 | 请求需要App管理员权限 | identifier的权限不足；**不证明签名已通过所有校验**，不是建议的签名校验手段 |
| 6032 | 无效的消息接收方 | 先检查原始接收userID、应用归属和账号是否存在；新账号从未成功登录/导入是常见原因，但不是唯一原因 |
| 20003 | 消息发送方或接收方UserID无效或不存在 | 同时检查发送方/接收方，不把发送逻辑或UI回调直接判为错误 |

70003在当前官网写“解析失败”，客户已装SDK头的注释为较泛的“UserSig校验失败，检查内容截断”；保留实际desc和SDK版本，不把两种措辞推导成唯一HMAC根因或固定校验顺序。

认证失败时仍核对SDKAppID、签名内identifier和登录userID、密钥所属应用、编码、时钟与有效期；HMAC值不匹配通常不能仅凭70003判断。不要把某次错误组合写成服务端固定校验顺序。

## 新应用首次收发

登录成功不证明对方账号已注册。发送前确认接收userID是原始ID，不是 `c2c_...` 会话ID、昵称或其他应用账号。让对方在同SDKAppID下完成一次成功登录，或通过业务服务端使用 [account_import](https://cloud.tencent.com/document/product/269/4919) 导入；需要时通过 [account_check](https://cloud.tencent.com/document/product/269/38417) 用具备管理员权限的业务服务端检查账号。REST操作需真实账号与授权，不能自动签管理员票据或偷偷导入生产账号。

## 迁移上线

移除客户端SecretKey和调试签名生成逻辑，由服务端鉴权后为用户签发对应票据，App只接收UserSig。Release构建排除DebugSignature；不要通过#if DEBUG为已泄露的真实密钥提供保护承诺，泄露仍需按业务流程轮换。不要让用户随意提交管理员UserSig或将其用于客户端登录。
