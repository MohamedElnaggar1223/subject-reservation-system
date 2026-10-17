/**
 * The heading of a printed paper (F8-11: the reservation slip and the receipt): the school's name as the admin set
 * it on Settings (decision 15's `school.name`), with the app's name under it — or the app's name alone when the
 * name is not set. The name is data: never translated.
 */

export const APP_PRINT_NAME = 'IGCSE Subject Reservation System';

export function PrintHeading({ schoolName, subtitle, className }: { schoolName: string; subtitle: string; className?: string }): React.JSX.Element {
  return (
    <div className={className}>
      {schoolName ? (
        <>
          <h1 className="font-display text-xl font-bold text-foreground print:text-black" dir="auto" data-i18n-skip="true">{schoolName}</h1>
          <p className="text-xs font-semibold text-muted-foreground print:text-black">{APP_PRINT_NAME}</p>
        </>
      ) : (
        <h1 className="font-display text-xl font-bold text-foreground print:text-black">{APP_PRINT_NAME}</h1>
      )}
      <p className="mt-1 text-sm text-muted-foreground print:text-black">{subtitle}</p>
    </div>
  );
}
