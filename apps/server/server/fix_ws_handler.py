import re

with open("ws/handler.ts", "r") as f:
    content = f.read()

content = content.replace('wsServer.on("connection", (socket) => {', 'export function setupWebSocketHandler(wsServer: any) {\n  wsServer.on("connection", (socket: any) => {')
content += "\n}\n"

with open("ws/handler.ts", "w") as f:
    f.write(content)
