import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase64url, encodeHexLowerCase } from '@oslojs/encoding';
import type { RequestEvent } from '@sveltejs/kit';
import { withCatch } from '@tfkhdyt/with-catch';
import { eq } from 'drizzle-orm';

const DAY_IN_MS = 1000 * 60 * 60 * 24;

export const sessionCookieName = 'auth-session';

export function generateSessionToken() {
	const bytes = crypto.getRandomValues(new Uint8Array(18));
	const token = encodeBase64url(bytes);
	return token;
}

export async function createSession(token: string, userId: number) {
	const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
	const session: table.Session = {
		id: sessionId,
		userId,
		expiresAt: new Date(Date.now() + DAY_IN_MS * 30)
	};

	const [err] = await withCatch(db.insert(table.session).values(session));
	if (err) {
		throw new Error('Error creating session', { cause: err });
	}

	return session;
}

export async function validateSessionToken(token: string) {
	const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));

	const [result] = await db
		.select({
			user: {
				id: table.user.id,
				name: table.user.name,
				email: table.user.email,
				picture: table.user.picture,
				creditsAmount: table.credits.amount
			},
			session: table.session
		})
		.from(table.session)
		.innerJoin(table.user, eq(table.session.userId, table.user.id))
		.leftJoin(table.credits, eq(table.user.id, table.credits.id))
		.where(eq(table.session.id, sessionId));

	if (!result) {
		return { session: null, user: null };
	}
	const { session, user } = result;

	const sessionExpired = Date.now() >= session.expiresAt.getTime();
	if (sessionExpired) {
		const [err] = await withCatch(db.delete(table.session).where(eq(table.session.id, session.id)));
		if (err) {
			throw new Error('Error deleting session', { cause: err });
		}

		return { session: null, user: null };
	}

	const renewSession = Date.now() >= session.expiresAt.getTime() - DAY_IN_MS * 15;
	if (renewSession) {
		session.expiresAt = new Date(Date.now() + DAY_IN_MS * 30);

		const [err] = await withCatch(
			db
				.update(table.session)
				.set({ expiresAt: session.expiresAt })
				.where(eq(table.session.id, session.id))
		);
		if (err) {
			throw new Error('Error updating session', { cause: err });
		}
	}

	return { session, user };
}

export type SessionValidationResult = Awaited<ReturnType<typeof validateSessionToken>>;

export async function invalidateSession(sessionId: string) {
	const [err] = await withCatch(db.delete(table.session).where(eq(table.session.id, sessionId)));
	if (err) {
		throw new Error('Error invalidate session', { cause: err });
	}
}

export function setSessionTokenCookie(event: RequestEvent, token: string, expiresAt: Date) {
	event.cookies.set(sessionCookieName, token, {
		expires: expiresAt,
		path: '/'
	});
}

export function deleteSessionTokenCookie(event: RequestEvent) {
	event.cookies.delete(sessionCookieName, {
		path: '/'
	});
}
