import { CredentialsSignin } from "next-auth";

export type LoginErrorCode =
  | "MISSING_CREDENTIALS"
  | "INVALID_CREDENTIALS"
  | "LOGIN_RATE_LIMITED"
  | "CAPTCHA_FAILED"
  | "LOGIN_INTERNAL_ERROR";

export class LoginCredentialsError extends CredentialsSignin {
  code: LoginErrorCode;

  constructor(code: LoginErrorCode) {
    super();
    this.code = code;
  }
}
