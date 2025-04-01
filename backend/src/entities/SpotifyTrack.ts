import { Collection, Entity, OneToMany, PrimaryKey, Property } from "@mikro-orm/core";
import { EventTrack } from "./EventTrack";

@Entity()
export class SpotifyTrack {
  @PrimaryKey({ nullable: false, unique: true })
  id: string;

  @Property()
  genre: string;

  @Property()
  duration: number;

  @Property()
  artist: string;

  @Property()
  artistName: string;

  @Property()
  trackName: string;

  @Property()
  albumImage: string;

  @OneToMany(() => EventTrack, (EventTrack) => EventTrack.track)
  eventTracks = new Collection<EventTrack>(this);

  constructor(trackID: string, trackName: string, duration: number, genre: string, artist: string, artistName: string, albumImage: string) {
    this.id = trackID;
    this.duration = duration;
    this.genre = genre;
    this.artist = artist;
    this.artistName = artistName;
    this.trackName = trackName;
    this.albumImage = albumImage;
  }
}