import { apiPost } from './http'

export type CreateRoomResponse = {
  roomCode: string
}

export async function createRoom(): Promise<CreateRoomResponse> {
  return apiPost<CreateRoomResponse>('/api/rooms', {})
}
