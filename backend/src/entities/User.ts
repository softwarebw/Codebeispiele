import {Collection, Entity, OneToMany, PrimaryKey, Property, types} from '@mikro-orm/core';
import {EventUser} from "./EventUser";

@Entity()
export class User {
    @PrimaryKey()
    spotifyId: string;

    // TODO: additional user profile info
    //@Property({type: types.text})
    //display_name: string;
    //@Property({type: types.text})
    //image_url: string;

    @Property({type: types.text, nullable: true })
    spotifyAccessToken: string | null;

    @Property({type: types.text, nullable: true})
    spotifyRefreshToken: string | null; // In a real application you shouldn't save the token in plain text -> Salt.

    @Property()
    expiresInMs: number;

    @Property({type: types.bigint})
    issuedAt: number;

    @OneToMany(() => EventUser, (EventUser) => EventUser.user)
    eventUsers = new Collection<EventUser>(this);

    constructor(userID: string, spotifyToken: string, SpotifyRefreshToken: string, expires_in_ms: number, issued_at: number) {
        this.spotifyId = userID;
        this.spotifyAccessToken = spotifyToken;
        this.spotifyRefreshToken = SpotifyRefreshToken;
        this.expiresInMs = expires_in_ms;
        this.issuedAt = issued_at;
    }
}