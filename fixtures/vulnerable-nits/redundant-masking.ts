function maskSecrets(message: string): string {
  return message.replace(/token=[^ ]+/, "token=***");
}

function recordAudit(message: string): void {
  auditStore.append(maskSecrets(message));
}

export function handleFailure(message: string): void {
  recordAudit(maskSecrets(message));
}
