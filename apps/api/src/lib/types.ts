import { auth } from './auth';

export type HonoEnv = {
    Variables: {
		user: typeof auth.$Infer.Session.user | null;
		// No token: better-auth's responses no longer carry it (RF-12), so the
		// type must not promise it — a `session.token` would compile and be
		// undefined at run time.
		session: Omit<typeof auth.$Infer.Session.session, 'token'> | null;
    	requestId?: string;
	}
};
