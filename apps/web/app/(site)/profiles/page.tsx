import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Button } from '@web/components/ui/button'
import { Input } from '@web/components/ui/input'

export const metadata: Metadata = {
  title: '公开资料',
  description: '通过用户 ID 查看 Starter 的公开资料。',
}

export default async function ProfilesIndexPage({ searchParams }: { searchParams: Promise<{ userId?: string }> }) {
  const { userId } = await searchParams
  const trimmedUserId = userId?.trim()
  if (trimmedUserId) redirect(`/profiles/${encodeURIComponent(trimmedUserId)}`)

  return (
    <main className="page-enter site-container py-16 md:py-24">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-primary">PUBLIC PROFILE</p>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">查看公开资料</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground">
          公开资料页不要求登录。输入资料链接中的用户 ID，打开 API 返回的真实资料。
        </p>
        <form action="/profiles" className="mt-10 flex flex-col gap-3 sm:flex-row" method="get">
          <label className="sr-only" htmlFor="profile-user-id">
            用户 ID
          </label>
          <Input className="h-12 flex-1" id="profile-user-id" name="userId" placeholder="输入用户 ID" required />
          <Button className="h-12 font-semibold transition-transform hover:-translate-y-0.5" type="submit">
            打开资料
          </Button>
        </form>
      </div>
    </main>
  )
}
