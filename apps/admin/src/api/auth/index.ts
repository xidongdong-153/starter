export { getAuthConfig } from './auth-config.api'
export {
  authQueryKeys,
  useAdminSessionQuery,
  useAuthConfigQuery,
  useSignInEmailMutation,
  useSignInSocialMutation,
  useSignOutMutation,
  useSignUpEmailMutation,
} from './auth.query'
export { getAdminSession } from './session.api'
export type { AdminSession, AdminSessionUser } from './session.api'
export { signInEmail, SignInError, signInSocial } from './sign-in.api'
export type { SignInEmailInput, SignInSocialInput, SocialProvider } from './sign-in.api'
export { signOut, SignOutError } from './sign-out.api'
export { signUpEmail, SignUpError } from './sign-up.api'
export type { SignUpEmailInput } from './sign-up.api'
