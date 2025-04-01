import {Collection, Entity, OneToMany, PrimaryKey, Property} from "@mikro-orm/core";
import {EventUser} from "./EventUser";
import {EventTrack} from "./EventTrack";
import {Playlist} from "./Playlist";

@Entity()
export class Event {
    @PrimaryKey({nullable: false, unique: true})
    id: string;

    @Property()
    name: string;

    @Property()
    date: Date;

    @Property()
    locked: boolean;

    @OneToMany(() => EventUser, (EventUser) => EventUser.event, { orphanRemoval: true })
    users = new Collection<EventUser>(this);

    @OneToMany(() => EventTrack, (EventTrack) => EventTrack.event, { orphanRemoval: true })
    eventTracks = new Collection<EventTrack>(this);

    @OneToMany(() => Playlist, playlist => playlist.event, { orphanRemoval: true })
    playlists = new Collection<Playlist>(this);

    constructor(EventID: string, EventName: string, EventDate: Date) {
        this.id = EventID;
        this.name = EventName;
        this.date = EventDate;
        this.locked = false;
    }
}
