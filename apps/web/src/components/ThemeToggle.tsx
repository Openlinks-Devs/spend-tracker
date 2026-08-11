import { IconSun, IconMoon, IconDeviceDesktop } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useThemePreference } from '@/hooks/useTheme'
import type { ThemePreference } from '@/lib/theme'

const OPTIONS: { value: ThemePreference; label: string; icon: typeof IconSun }[] = [
  { value: 'light', label: 'Light', icon: IconSun },
  { value: 'dark', label: 'Dark', icon: IconMoon },
  { value: 'system', label: 'System', icon: IconDeviceDesktop },
]

/**
 * Three states, not a two-way switch: "system" is a real choice distinct from
 * picking light or dark, and a toggle cannot express "follow my OS". Each option
 * carries an icon plus an accessible name, so the current state is never
 * signalled by colour alone.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useThemePreference()

  return (
    <div
      className={cn('inline-flex items-center gap-0.5 rounded-md border p-0.5', className)}
      role="group"
      aria-label="Colour theme"
    >
      {OPTIONS.map((option) => {
        const OptionIcon = option.icon
        const isSelected = preference === option.value
        return (
          <Button
            key={option.value}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={isSelected}
            aria-label={option.label}
            title={option.label}
            className={cn(
              'h-7 w-7 p-0',
              isSelected
                ? 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
                : 'text-muted-foreground',
            )}
            onClick={() => setPreference(option.value)}
          >
            <OptionIcon className="h-4 w-4" />
          </Button>
        )
      })}
    </div>
  )
}
