export { getAuthConfig } from './auth-config.api'
export {
  authQueryKeys,
  useAdminSessionQuery,
  useAuthConfigQuery,
  useChangePasswordMutation,
  useLinkSocialMutation,
  useRequestPasswordResetMutation,
  useResetPasswordMutation,
  useSendVerificationEmailMutation,
  useSignInEmailMutation,
  useSignInSocialMutation,
  useSignOutMutation,
  useSignUpEmailMutation,
  useVerifyEmailMutation,
} from './auth.query'
export { changePassword } from './change-password.api'
export type { ChangePasswordInput } from './change-password.api'
export { requestPasswordReset } from './forgot-password.api'
export type { RequestPasswordResetInput } from './forgot-password.api'
export { linkSocial, LinkSocialError } from './link-social.api'
export { resetPassword } from './reset-password.api'
export type { ResetPasswordInput } from './reset-password.api'
export { getAdminSession } from './session.api'
export type { AdminSession, AdminSessionUser } from './session.api'
export { signInEmail, SignInError, signInSocial } from './sign-in.api'
export type { SignInEmailInput, SignInSocialInput, SocialProvider } from './sign-in.api'
export { signOut, SignOutError } from './sign-out.api'
export { signUpEmail, SignUpError } from './sign-up.api'
export type { SignUpEmailInput } from './sign-up.api'
export { sendVerificationEmail, SendVerificationEmailError, verifyEmail, VerifyEmailError } from './verify-email.api'
