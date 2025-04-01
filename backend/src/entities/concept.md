
[DATEI UM ENTITIES & DB ZU PLANEN :)]

!!11!!elf "Spotify-*" sind spotify-api-daten

Event: TrackList[Spotify-Track],UserList[User], duration, EventID, Owner
Spotify-Playlist: TrackList[Spotify-Track],duration,PlaylistID
Spotify-Track: Genre, duration, Artist,isInPlaylist[PlaylistID],TrackID,isInEvent[EventID]
User:EventList[Event],name,UserID

EventUser: permissions: owner/admin/mod/user/guest

Statische Daten:::

Event:
TrackList[Spotify-Track],
UserList[User],
TracksProposed[Spotify-Track],  
duration: time,
EventID: integer(?)UNIQUE,
Owner: User,

Event n:m EventTrack
Event 1:1 User(Owner)
Event n:m User -> EventUser (Admin/Mod/Participant/etc.)
Event 1:n EventSchedules -> timestamp, trackid -> sortiert

SpotifyTrack n:m SpotifyPlaylist

EventTrack:
- track: SpotifyTrack
- trackorder : int
- status: proposed/accepted/generated/denied


- Scheduling durch TrackOrder

Algorithmus:::
Von jedem User top 20 Songs herausziehen und als playlist speichern???
Vergleichen der Playlists für jeden User

zur Laufzeit des Algorithmus wird benötigt:
user 1:n genre
user 1:n top artist
user 1:n top songs

Daten im Arbeitsspeicher sammlen & auswerten
-> generated Tracklist erstellen
-> generated Tracklist in db speichern

Spotify-Token:



1. Token von Spotify bekommen
2. Token an client zurückschicken.

2. eigenen Token mit credentials+ Spotify-Token erstellen
3. jede Aktion, welche mit dem eigenen Token ausgeführt wird, benutzt den Spotify-Token aus dem eigenen Token
4. ???
5. Profit
