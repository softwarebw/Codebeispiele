import { Collection, Entity, ManyToMany, ManyToOne, Property, PrimaryKey } from "@mikro-orm/core";
import { Event } from "./Event";
import { SpotifyTrack } from "./SpotifyTrack";
import { Playlist } from "./Playlist";
import { v4 } from "uuid";

// hierarchical order, top to bottom, every level has all rights of all levels above
export enum TrackStatus {
  DENIED,
  PROPOSED,
  ACCEPTED_PLAYLIST,
  GENERATED,
  ACCEPTED,
}

@Entity()
export class EventTrack {
  @PrimaryKey({ nullable: false, unique: true })
  id: string;

  @Property()
  status!: TrackStatus;

  @ManyToOne({ entity: () => SpotifyTrack })
  track: SpotifyTrack;

  @ManyToOne({ entity: () => Event, primary: true })
  event: Event;

  @ManyToMany(() => Playlist, "eventTracks", { owner: true })
  playlists = new Collection<Playlist>(this);

  constructor(status: TrackStatus, track: SpotifyTrack, event: Event) {
    this.id = v4();
    this.status = status;
    this.track = track;
    this.event = event;
  }
}