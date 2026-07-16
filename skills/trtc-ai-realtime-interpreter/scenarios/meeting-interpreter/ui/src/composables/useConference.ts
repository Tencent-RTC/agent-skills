import { conference } from '@tencentcloud/roomkit-web-vue3'
import { useRoomState, useLoginState, useRoomParticipantState, useDeviceState } from 'tuikit-atomicx-vue3/room'
import { fetchConfig, registerRoom } from '@/api/backend'
import { useAppStore } from '@/store'

/**
 * Conference 层封装：登录鉴权（UserSig 由后端签发）+ 建房/进房/离房生命周期。
 * 这是 Layer 1 的核心，AI 翻译（Layer 2）在其之上独立叠加。
 */
export function useConference() {
  const app = useAppStore()
  const { currentRoom, createAndJoinRoom, joinRoom, leaveRoom, endRoom } = useRoomState()
  const { loginUserInfo } = useLoginState()
  const { updateParticipantNameCard } = useRoomParticipantState()
  const { openLocalMicrophone, openLocalCamera } = useDeviceState()

  /** 登录：向后端申请临时 UserSig，再调 conference.login，并设置展示名。 */
  async function login(displayName: string, userId?: string): Promise<void> {
    const cfg = await fetchConfig(userId)
    app.setConfig(cfg)
    await conference.login({
      sdkAppId: cfg.sdkappid,
      userId: cfg.userid,
      userSig: cfg.usersig,
    })
    await conference.setSelfInfo({ userName: displayName, avatarUrl: '' })
  }

  /** 进房后把自己的房内昵称设为输入的名字——nameCard 会广播给全员，远端就能看到正确名字。 */
  async function applyNameCard() {
    const cfg = app.state.config
    if (!cfg || !app.state.displayName) return
    try {
      await updateParticipantNameCard({ userId: cfg.userid, nameCard: app.state.displayName })
    } catch (e) {
      console.error('set nameCard failed', e)
    }
  }

  /** 创建并进入房间（成为房主）。roomId 由业务生成。 */
  async function createRoom(roomId: string, roomName: string): Promise<void> {
    await createAndJoinRoom({ roomId, options: { roomName } })
    app.setRoom(roomId, roomName, true)
    // 登记房间归属，供后端主持人权限校验使用
    const cfg = app.state.config
    if (cfg) {
      try {
        await registerRoom(roomId, cfg.userid)
      } catch (e) {
        console.error('register room failed', e)
      }
    }
    await applyNameCard()
  }

  /** 加入已有房间（成为普通参会人）。opts 控制入会时是否开启麦克风/摄像头。 */
  async function joinExistingRoom(roomId: string, opts?: { micOn?: boolean; camOn?: boolean }): Promise<void> {
    await joinRoom({ roomId })
    app.setRoom(roomId, roomId, false)
    await applyNameCard()
    if (opts?.micOn) {
      try {
        await openLocalMicrophone()
      } catch (e) {
        console.error('open mic on join failed', e)
      }
    }
    if (opts?.camOn) {
      try {
        await openLocalCamera()
      } catch (e) {
        console.error('open camera on join failed', e)
      }
    }
  }

  /** 离开房间（普通成员）。 */
  async function leave() {
    await leaveRoom()
    app.resetRoom()
  }

  /** 结束房间（仅房主）。 */
  async function end() {
    await endRoom()
    app.resetRoom()
  }

  return {
    currentRoom,
    loginUserInfo,
    login,
    createRoom,
    joinExistingRoom,
    leave,
    end,
  }
}
