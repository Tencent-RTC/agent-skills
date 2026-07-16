/**
 * 通用「静默旁听」TRTC Web 客户端封装（conversation-core 的前端配套工具）。
 *
 * 用途：不依赖上层是否把 TRTC 引擎暴露给业务方（比如接入了 Atomicx/RoomKit 这类
 * 无 UI 会议 SDK 时，业务层通常拿不到底层 engine 实例去监听 CUSTOM_MESSAGE），
 * 而是另起一个独立身份，静默进同一个 SdkAppId+RoomId，不推流、不订阅音视频，
 * 只挂 CUSTOM_MESSAGE 监听 —— 零风险、不依赖任何会议 SDK 内部实现。
 *
 * 这是「怎么收到 AI 通道消息」的通用机制，跟「收到消息后怎么解析 payload」是两件事：
 * 后者（比如翻译字幕解析）由具体业务能力包（realtime-translation）实现，通过
 * onCustomMessage 回调接上去，不需要重新造进房/退房这一层轮子。
 *
 * 使用方需要自行 `npm install trtc-sdk-v5`（依赖由业务项目安装，本文件不打包依赖）。
 */

export interface SilentListenerConfig {
  sdkAppId: number
  roomId: string
  userId: string
  userSig: string
  /** TRTC Web SDK 静态资源路径，默认官方 CDN */
  assetsPath?: string
}

export interface SilentListenerHandle {
  enter: () => Promise<void>
  exit: () => Promise<void>
  onCustomMessage: (cb: (event: any) => void) => void
  onError: (cb: (err: any) => void) => void
}

/**
 * 创建一个静默旁听客户端。调用 enter() 后即进房收自定义消息，不会有任何本地
 * 采集/推流/播放行为；调用 exit() 退房并销毁底层实例。
 *
 * @param TRTC 由调用方传入 `trtc-sdk-v5` 的默认导出（避免本文件强制依赖该包）
 */
export function createSilentListener(TRTC: any, cfg: SilentListenerConfig): SilentListenerHandle {
  let client: any = null
  let customMessageCb: ((event: any) => void) | null = null
  let errorCb: ((err: any) => void) | null = null

  async function enter(): Promise<void> {
    if (client) return
    client = TRTC.create({
      assetsPath: cfg.assetsPath || 'https://web.sdk.qcloud.com/trtc/webrtc/v5/assets/',
    })
    client.on(TRTC.EVENT.CUSTOM_MESSAGE, (event: any) => {
      customMessageCb?.(event)
    })
    client.on(TRTC.EVENT.ERROR, (err: any) => {
      errorCb?.(err)
    })
    await client.enterRoom({
      strRoomId: cfg.roomId,
      scene: 'rtc',
      sdkAppId: cfg.sdkAppId,
      userId: cfg.userId,
      userSig: cfg.userSig,
      // 旁听客户端不播音频：避免跟业务方自己的会议/直播客户端重复播放 AI 的 TTS
      autoReceiveAudio: false,
    })
    // 静默旁听：不调用 startLocalAudio / startLocalVideo
  }

  async function exit(): Promise<void> {
    if (!client) return
    try {
      await client.exitRoom()
    } catch {
      /* ignore */
    }
    try {
      client.destroy()
    } catch {
      /* ignore */
    }
    client = null
  }

  return {
    enter,
    exit,
    onCustomMessage: (cb) => {
      customMessageCb = cb
    },
    onError: (cb) => {
      errorCb = cb
    },
  }
}
