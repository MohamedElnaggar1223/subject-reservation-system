"""Migration 0061's proof on a fresh copy of igcse_template_dev (the coordinator's resume message): main 19dabff's
migration set to 61, then the branch's set to 62, then a second migrate and the statement by hand. The scratch
database igcse_decisions_mig is this worktree's own; no other database is written. Prints the proof (the database
URL's password never printed)."""
import datetime, os, re, subprocess, sys

WT = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/cycle-decisions'
LEAD = '/Users/mohamedelnaggar/Coding/subject-reservation-system/.claude/worktrees/lead-env'
MAIN_SET = '/tmp/cd/mig-main'
DB = 'igcse_decisions_mig'
now = lambda: datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

url = next(l.split('=', 1)[1].strip() for l in open(f'{WT}/apps/api/.env') if l.startswith('DATABASE_URL='))
assert '?' not in url
url = url.rsplit('/', 1)[0] + f'/{DB}'

def run(cmd, env=None, input=None):
    p = subprocess.run(cmd, capture_output=True, text=True, env=dict(os.environ, **(env or {})), input=input)
    return p.returncode, (p.stdout + p.stderr).strip()

def psql(sql, db=DB):
    code, out = run(['docker', 'exec', '-i', 'igcse-dev-db', 'psql', '-U', 'audit', '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input=sql)
    if code:
        sys.exit(f'psql failed: {out}')
    return out

def state(label):
    print(f'   migrations: {psql("select count(*) from drizzle.__drizzle_migrations;")}')
    for row in psql("select board_code || ' | ' || notes from exam_board_rule order by board_code;").splitlines():
        print(f'   {row}')
    print(f'   audit rows (EXAM_BOARD_RULE_UPDATED, no user): {psql("select count(*) from audit_log where action = \'EXAM_BOARD_RULE_UPDATED\' and user_id is null;")}')

def migrate(config_dir, config):
    code, out = run(['pnpm', '-C', config_dir, 'exec', 'drizzle-kit', 'migrate', f'--config={config}'], env={'DATABASE_URL': url})
    if code:
        sys.exit(f'migrate failed: {out[-2000:]}')

print(f'Migration 0061_rule_source_notes, the proof run again on the final code (115508f) at {now()}, on a fresh copy')
print(f'of igcse_template_dev.')

# Main's set, byte-identical to 19dabff's packages/db/drizzle.
_, tree = run(['git', '-C', LEAD, 'ls-tree', '-r', '19dabff', '--', 'packages/db/drizzle/'])
blobs = {l.split('\t')[1][len('packages/db/drizzle/'):]: l.split()[2] for l in tree.splitlines()}
files = sorted(os.path.relpath(os.path.join(d, f), f'{MAIN_SET}/drizzle') for d, _, fs in os.walk(f'{MAIN_SET}/drizzle') for f in fs)
_, hashes = run(['git', '-C', LEAD, 'hash-object', '--stdin-paths'], input='\n'.join(f'{MAIN_SET}/drizzle/{f}' for f in files) + '\n')
same = files == sorted(blobs) and all(blobs[f] == h for f, h in zip(files, hashes.split()))
print(f'main\'s set: {len(files)} files, byte-identical to 19dabff\'s packages/db/drizzle: {same}')
if not same:
    sys.exit('main set differs')
# The branch's 0057 is main's too.
_, b57 = run(['git', '-C', LEAD, 'hash-object', f'{WT}/packages/db/drizzle/0057_exam_entries_board_rules.sql'])
print(f'the branch\'s 0057 blob {b57[:7]} = 19dabff\'s {blobs["0057_exam_entries_board_rules.sql"][:7]}: {b57 == blobs["0057_exam_entries_board_rules.sql"]}')

psql(f'drop database if exists {DB};', db='postgres')
psql(f'create database {DB} template igcse_template_dev;', db='postgres')
print(f'{DB} = CREATE DATABASE … TEMPLATE igcse_template_dev; it holds {psql("select count(*) from drizzle.__drizzle_migrations;")} migrations.')

print('\n1. Migrated with main 19dabff\'s set:')
migrate(f'{WT}/packages/db', f'{MAIN_SET}/drizzle.config.ts')
state('main')

print('\n2. Migrated with the branch\'s set (0061 the one pending):')
migrate(f'{WT}/packages/db', 'drizzle.config.ts')
state('branch')
print('   the audit rows:')
for row in psql("select entity_id || ' | ' || (previous_data->>'notes') || ' -> ' || (new_data->>'notes') || ' | ' || (new_data->>'reason') from audit_log where action = 'EXAM_BOARD_RULE_UPDATED' and user_id is null order by entity_id;").splitlines():
    print(f'   {row}')
_, sha = run(['shasum', '-a', '256', f'{WT}/packages/db/drizzle/0061_rule_source_notes.sql'])
print(f'   0061 recorded with hash {psql("select hash from drizzle.__drizzle_migrations order by id desc limit 1;")[:16]}…; the file\'s sha256 {sha.split()[0][:16]}…')

print('\n3. A second migrate, then 0061\'s statement by hand:')
migrate(f'{WT}/packages/db', 'drizzle.config.ts')
print(f'   migrations after the second migrate: {psql("select count(*) from drizzle.__drizzle_migrations;")}')
stmt = open(f'{WT}/packages/db/drizzle/0061_rule_source_notes.sql').read()
code, out = run(['docker', 'exec', '-i', 'igcse-dev-db', 'psql', '-U', 'audit', '-d', DB, '-v', 'ON_ERROR_STOP=1'], input=stmt)
print(f'   the statement by hand: {out.splitlines()[-1] if out else code}')
state('again')
print(f'\nDone at {now()}.')
