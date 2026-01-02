import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    const disableWebsocket = import.meta.env.VITE_SOCKETIO_DISABLE_WEBSOCKET === '1'
    socket = io('/', {
      transports: disableWebsocket ? ['polling'] : ['websocket', 'polling'],
    })
  }
  return socket
}
