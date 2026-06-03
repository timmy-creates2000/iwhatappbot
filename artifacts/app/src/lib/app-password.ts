const SESSION_KEY = "app_password";

export function getStoredPassword(): string | null {
  return sessionStorage.getItem(SESSION_KEY);
}

export function storePassword(password: string): void {
  sessionStorage.setItem(SESSION_KEY, password);
}

export function clearPassword(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
