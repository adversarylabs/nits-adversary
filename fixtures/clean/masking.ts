function maskForClient(message: string): string {
  return message.replace(/token=[^ ]+/, "token=***");
}

function maskForStorage(message: string): string {
  return message.replace(/credential=[^ ]+/, "credential=***");
}

function recordAudit(message: string): void {
  auditStore.append(maskForStorage(message));
}

export function reportFailure(message: string): void {
  protocolSocket.send(maskForClient(message));
  recordAudit(maskForClient(message));
  recordAudit(encodeURIComponent(message));
}
