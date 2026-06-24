export interface CredentialField {
  name: string;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
}

export interface Storage {
  readonly id: string;
  readonly label: string;
  /** Set when this backend cannot be used in the current browser environment. */
  readonly unavailableReason?: string;
  isAuthenticated(): boolean;
  readonly credentialFields?: CredentialField[];
  connect(creds?: Record<string, string>): Promise<void>;
  disconnect(): void;
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
}
