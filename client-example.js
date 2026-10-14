// Contoh pemakaian dari index.html/Phaser.
const API = 'https://api.example.com';
let token;

export async function register(username, password, displayName = username) {
  const response = await fetch(`${API}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, displayName })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'REGISTER_FAILED');
  token = data.token;
  return data.user;
}

export async function login(username, password) {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'LOGIN_FAILED');
  token = data.token;
  return data.user;
}

export async function createRoom(distance = 201) {
  const response = await fetch(`${API}/api/matches`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ distance })
  });
  return response.json();
}

export function connectRoom(roomCode, onMessage) {
  const socket = new WebSocket(`${API.replace('https://', 'wss://').replace('http://', 'ws://')}/ws?token=${encodeURIComponent(token)}&room=${encodeURIComponent(roomCode)}`);
  socket.onmessage = (event) => onMessage(JSON.parse(event.data));
  return {
    socket,
    ready: () => socket.send(JSON.stringify({ type: 'ready' })),
    start: () => socket.send(JSON.stringify({ type: 'start' })),
    progress: (x) => socket.send(JSON.stringify({ type: 'progress', x })),
    finish: (time, foul = false) => socket.send(JSON.stringify({ type: 'finish', time, foul }))
  };
}
