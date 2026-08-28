import type { Metadata } from 'next'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { ArrowLeft, BriefcaseBusiness, Link2, MapPin, Mail } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@web/components/ui/button'
import { uuidSchema } from '@starter/contracts'
import { getPublicProfile, getPublicProfileAvatarUrl } from '@web/lib/api/profile.api'
import { isApiRequestError } from '@web/lib/http'

const readProfile = cache(async (userId: string) => {
  if (!uuidSchema.safeParse(userId).success) return null

  try {
    return await getPublicProfile(userId)
  } catch (error) {
    if (isApiRequestError(error, 404)) return null
    throw error
  }
})

export async function generateMetadata({ params }: { params: Promise<{ userId: string }> }): Promise<Metadata> {
  const { userId } = await params
  const profile = await readProfile(userId)
  if (!profile) return {}

  return {
    title: `${profile.name} 的公开资料`,
    description: profile.bio ?? undefined,
  }
}

export default async function PublicProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const profile = await readProfile(userId)
  if (!profile) notFound()

  return (
    <main className="page-enter site-container py-12 md:py-20">
      <Button
        asChild
        className="justify-start gap-2 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
        variant="ghost"
      >
        <Link href="/profiles">
          <ArrowLeft aria-hidden="true" size={16} />
          其他公开资料
        </Link>
      </Button>

      <section className="mt-12 max-w-3xl border-t border-border pt-8 md:mt-16 md:pt-10">
        <div className="flex flex-col gap-7 sm:flex-row sm:items-start">
          {profile.avatarUrl ? (
            <img
              alt={`${profile.name} 的头像`}
              className="size-24 shrink-0 border border-border object-cover sm:size-28"
              height={112}
              src={getPublicProfileAvatarUrl(profile.avatarUrl)}
              width={112}
            />
          ) : (
            <div
              aria-hidden="true"
              className="grid size-24 shrink-0 place-items-center bg-surface-muted text-2xl text-primary sm:size-28"
            >
              {profile.name.slice(0, 1)}
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-primary">PUBLIC PROFILE</p>
            <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">{profile.name}</h1>
            {profile.location ? (
              <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin aria-hidden="true" size={15} />
                {profile.location}
              </p>
            ) : null}
          </div>
        </div>

        {profile.bio ? <p className="mt-10 max-w-2xl text-lg leading-8 text-muted-foreground">{profile.bio}</p> : null}

        <div className="mt-10 grid gap-4 border-y border-border-subtle py-6 text-sm sm:grid-cols-2">
          {profile.availableForWork ? (
            <p className="inline-flex items-center gap-2 text-success">
              <BriefcaseBusiness aria-hidden="true" size={16} />
              目前可接受工作机会
            </p>
          ) : null}
          {profile.contactEmail ? (
            <a
              className="inline-flex min-h-10 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
              href={`mailto:${profile.contactEmail}`}
            >
              <Mail aria-hidden="true" size={16} />
              {profile.contactEmail}
            </a>
          ) : null}
        </div>

        {profile.socialLinks.length > 0 ? (
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
            {profile.socialLinks.map((url) => (
              <a
                className="inline-flex min-h-10 items-center gap-2 text-sm text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                href={url}
                key={url}
                rel="noopener noreferrer"
                target="_blank"
              >
                <Link2 aria-hidden="true" size={15} />
                {new URL(url).hostname}
              </a>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  )
}
