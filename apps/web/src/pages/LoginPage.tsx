import { useSearchParams } from 'react-router'
import { IconBrandGoogle } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { signIn } from '@/lib/authClient'

export function LoginPage() {
  const [searchParams] = useSearchParams()
  const hasError = searchParams.has('error')
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to SpendTracker</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasError ? (
            <p className="text-sm text-destructive">
              This account is not authorized to access SpendTracker.
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            onClick={() => signIn.social({ provider: 'google', callbackURL: '/' })}
          >
            <IconBrandGoogle className="h-4 w-4" />
            Sign in with Google
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
