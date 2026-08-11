export { getAuthConfig } from './auth-config.api'
export {
  authQueryKeys,
  useAdminSessionQuery,
  useAuthConfigQuery,
  useLinkSocialMutation,
  useSignInEmailMutation,
  useSignInSocialMutation,
  useSignOutMutation,
  useSignUpEmailMutation,
} from './auth.query'
export { linkSocial, LinkSocialError } from './link-social.api'
export { getAdminSession } from './session.api'
export type { AdminSession, AdminSessionUser } from './session.api'
export { signInEmail, SignInError, signInSocial } from './sign-in.api'
export type { SignInEmailInput, SignInSocialInput, SocialProvider } from './sign-in.api'
export { signOut, SignOutError } from './sign-out.api'
export { signUpEmail, SignUpError } from './sign-up.api'
export type { SignUpEmailInput } from './sign-up.api'
