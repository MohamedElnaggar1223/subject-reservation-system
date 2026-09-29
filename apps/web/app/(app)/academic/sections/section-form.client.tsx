'use client';

/**
 * Create or edit a section (FEATURES_PLAN.md F0a): grade, name, homeroom
 * teacher, room and capacity.
 *
 * The spreadsheet version: a new tab named "11C", with the teacher and the
 * room typed in a header row that nothing checks (a teacher who left, a
 * room that no longer exists). Here the name is suggested (the next free
 * letter for the grade), the teacher and the room are picked from the
 * school's own lists, and the API refuses a duplicate name with its reason.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiResponse, gradeLabel } from '@repo/validations';
import { api } from '~/lib/hono';
import { Button } from '~/components/ui/button';
import { AsWritten, Dialog } from '~/components/student-academic-panel';
import { fetchActiveTeachers, fetchRooms, keys, type SectionRow } from './sections.data';

const GRADES = [10, 11, 12] as const;
type Grade = (typeof GRADES)[number];

const fieldClass =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary';

/** The first free name for a grade: 10A, 10B, … */
export function suggestName(grade: number, taken: string[]): string {
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const name = `${grade}${letter}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  return `${grade}`;
}

/** What the form edits: a section of the grid, or a section's page (the same fields). */
type Editable = Pick<SectionRow, 'id' | 'name' | 'grade' | 'capacity'> & {
  homeroomTeacher: { id: string; name: string } | null;
  room: { id: string; name: string } | null;
};

export function SectionForm({
  academicYearId,
  grade: presetGrade,
  section,
  takenNames,
  onClose,
  onSaved,
}: {
  academicYearId: string;
  grade?: Grade;
  section?: Editable;
  takenNames: string[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const { data: teachers = [] } = useQuery({ queryKey: keys.teachers, queryFn: fetchActiveTeachers });
  const { data: rooms = [] } = useQuery({ queryKey: keys.rooms, queryFn: fetchRooms });

  const startGrade = (section?.grade as Grade | undefined) ?? presetGrade ?? 10;
  const [grade, setGrade] = useState<Grade>(startGrade);
  const [name, setName] = useState(section?.name ?? suggestName(startGrade, takenNames));
  const [nameTouched, setNameTouched] = useState(!!section);
  const [teacherId, setTeacherId] = useState(section?.homeroomTeacher?.id ?? '');
  const [roomId, setRoomId] = useState(section?.room?.id ?? '');
  const [capacity, setCapacity] = useState(section?.capacity ? String(section.capacity) : '');
  const [error, setError] = useState('');

  // An inactive teacher or room already on the section stays choosable, so editing does not drop it by accident.
  const teacherOptions = [
    ...teachers.map((t) => ({ id: t.id, name: t.name })),
    ...(section?.homeroomTeacher && !teachers.some((t) => t.id === section.homeroomTeacher!.id) ? [section.homeroomTeacher] : []),
  ];
  const activeRooms = rooms.filter((r) => r.isActive);
  const roomOptions = [
    ...activeRooms.map((r) => ({ id: r.id, name: r.name, capacity: r.capacity })),
    ...(section?.room && !activeRooms.some((r) => r.id === section.room!.id) ? [{ ...section.room, capacity: null }] : []),
  ];

  const save = useMutation({
    mutationFn: async () => {
      const common = {
        name: name.trim(),
        homeroomTeacherId: teacherId || null,
        roomId: roomId || null,
        capacity: capacity ? Number(capacity) : null,
      };
      if (section) {
        const updated = await apiResponse(api.v1.academic.sections[':id'].$put({ param: { id: section.id }, json: common }));
        return updated.id;
      }
      const created = await apiResponse(api.v1.academic.sections.$post({ json: { academicYearId, grade, ...common } }));
      return created.id;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['academic'] });
      qc.invalidateQueries({ queryKey: ['students'] });
      onSaved(id);
    },
    onError: (err: Error) => setError(err.message),
  });

  const capacityNumber = capacity ? Number(capacity) : null;
  const capacityInvalid = capacityNumber !== null && (!Number.isInteger(capacityNumber) || capacityNumber < 1 || capacityNumber > 200);
  const ready = name.trim().length > 0 && !capacityInvalid;
  const chosenRoom = roomOptions.find((r) => r.id === roomId);

  return (
    <Dialog title={section ? 'Edit the section' : 'Add a section'} busy={save.isPending} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          if (ready) save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="section-grade" className="mb-1 block text-sm font-medium text-foreground">
              Grade
            </label>
            <select
              id="section-grade"
              value={grade}
              disabled={!!section}
              onChange={(e) => {
                const g = Number(e.target.value) as Grade;
                setGrade(g);
                if (!nameTouched) setName(suggestName(g, takenNames));
              }}
              className={fieldClass}
            >
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {gradeLabel(g)}
                </option>
              ))}
            </select>
            {section && <p className="mt-1 text-xs text-muted-foreground">A section keeps its grade; its students were placed by it.</p>}
          </div>
          <div>
            <label htmlFor="section-name" className="mb-1 block text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="section-name"
              value={name}
              maxLength={20}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              placeholder="e.g. 11A"
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor="section-teacher" className="mb-1 block text-sm font-medium text-foreground">
              Homeroom teacher
            </label>
            <select id="section-teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className={fieldClass}>
              <option value="">Not named yet</option>
              {teacherOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="section-room" className="mb-1 block text-sm font-medium text-foreground">
              Room
            </label>
            <select id="section-room" value={roomId} onChange={(e) => setRoomId(e.target.value)} className={fieldClass}>
              <option value="">No room yet</option>
              {roomOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {rooms.length === 0 && (
              <p className="mt-1 text-xs text-muted-foreground">No rooms yet: add them on the Rooms page.</p>
            )}
          </div>
          <div>
            <label htmlFor="section-capacity" className="mb-1 block text-sm font-medium text-foreground">
              Capacity
            </label>
            <input
              id="section-capacity"
              type="number"
              inputMode="numeric"
              min={1}
              max={200}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="No limit"
              className={fieldClass}
            />
            {capacityInvalid ? (
              <p className="mt-1 text-xs text-destructive">A whole number from 1 to 200, or empty for no limit.</p>
            ) : (
              chosenRoom?.capacity != null &&
              !capacity && (
                <button
                  type="button"
                  className="mt-1 text-xs text-primary underline hover:no-underline"
                  onClick={() => setCapacity(String(chosenRoom.capacity))}
                >
                  <span>Use the room&apos;s capacity:</span> <span>{chosenRoom.capacity}</span>
                </button>
              )
            )}
          </div>
        </div>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            <AsWritten>{error}</AsWritten>
          </p>
        )}

        <div className="flex gap-3">
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" className="h-10 flex-1" disabled={save.isPending || !ready}>
            {save.isPending ? 'Saving…' : section ? 'Save' : 'Add the section'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
