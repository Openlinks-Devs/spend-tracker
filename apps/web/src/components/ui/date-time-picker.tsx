import * as React from 'react'
import { IconCalendar } from '@tabler/icons-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn, toDatetimeLocalValue } from '@/lib/utils'

const triggerLabelFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

interface DateTimePickerProps {
  id?: string
  /** Value in datetime-local format ("YYYY-MM-DDTHH:mm"), or '' when unset. */
  value: string
  onChange: (value: string) => void
}

function DateTimePicker({ id, value, onChange }: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selectedDate = value ? new Date(value) : undefined
  const timeValue = value ? value.slice(11, 16) : '00:00'

  function handleDaySelect(day: Date | undefined) {
    if (!day) return
    const [hours, minutes] = timeValue.split(':').map(Number)
    const combined = new Date(day)
    combined.setHours(hours, minutes)
    onChange(toDatetimeLocalValue(combined))
  }

  function handleTimeChange(newTime: string) {
    if (!newTime) return
    const day = selectedDate ?? new Date()
    onChange(`${toDatetimeLocalValue(day).slice(0, 10)}T${newTime}`)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-muted-foreground',
          )}
        >
          <IconCalendar className="mr-2 h-4 w-4" />
          {selectedDate ? triggerLabelFormatter.format(selectedDate) : 'Pick a date and time'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          defaultMonth={selectedDate}
          onSelect={handleDaySelect}
        />
        <div className="flex items-center gap-3 border-t p-3">
          <Label htmlFor={id ? `${id}-time` : undefined} className="text-sm">
            Time
          </Label>
          <Input
            id={id ? `${id}-time` : undefined}
            type="time"
            value={timeValue}
            onChange={(event) => handleTimeChange(event.target.value)}
            className="h-8"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

export { DateTimePicker }
