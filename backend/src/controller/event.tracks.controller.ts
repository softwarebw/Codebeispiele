import { Router } from "express";
import { DI } from "../index";
import axios from "axios";
import { Auth } from "../middleware/auth.middleware";
import { EventTrack, TrackStatus } from "../entities/EventTrack";
import { Event } from "../entities/Event";
import { SpotifyTrack } from "../entities/SpotifyTrack";
import { Playlist } from "../entities/Playlist";
import { Collection } from "@mikro-orm/core";
import util from "util";
import { User } from "../entities/User";

const router = Router({ mergeParams: true });

router.get("/search", async (req, res) => {
  const { query } = req.query;

  axios
    .get("https://api.spotify.com/v1/search", {
      params: {
        q: query,
        type: "track",
        limit: 10,
      },
      headers: {
        Authorization: `Bearer ${req.user!.spotifyAccessToken}`,
      },
    })
    .then((response) => {
      const tracks = response.data.tracks.items.map((item: any) => ({
        id: item.id,
        name: item.name,
        artist: item.artists.map((artist: any) => artist.name).join(", "),
        albumImage: item.album.images[0]?.url || "",
      }));

      if (tracks.length === 0) return res.status(200).json([]);
      return res.status(200).json(tracks);
    })
    .catch(function (error) {
      return res.status(error.status).send(error);
    });
});

// fetch ids of all playlists
router.get("/spotifyPlaylistIds", async (req, res) => {
  const eventId = req.event?.id;
  if (!eventId) return res.status(400).json({ error: "Event ID not provided" });
  const playlists = await DI.em.find(Playlist, { event: { id: eventId } });
  const playlistIds = playlists.map((playlist) => playlist.id);
  res.status(200).json(playlistIds);
});

// fetch all tracks of playlist
router.get("/:spotifyPlaylistId", async (req, res) => {
  const playlist = await DI.em.findOne(
    Playlist,
    {
      id: req.params.spotifyPlaylistId,
      event: { id: req.event!.id },
    },
    { populate: ["eventTracks", "eventTracks.track"] } // Include the "track" property of EventTrack
  );
  if (!playlist) return res.status(404).end();

  const playlistResponse = await axios.get(
    `https://api.spotify.com/v1/playlists/${playlist.id}`,
    {
      headers: {
        Authorization: `Bearer ${req.user!.spotifyAccessToken}`,
      },
    }
  );
  if (!playlistResponse.data || playlistResponse.data.tracks.total === 0) {
    const event = await DI.em.findOne(Event, { id: req.event!.id });
    if (!event) return res.status(404).json({ error: "Event not found" });

    await req.event!.eventTracks.init();
    for (const eventTrack of req.event!.eventTracks)
      await DI.em.removeAndFlush(eventTrack);
    req.event!.eventTracks.removeAll();

    await req.event!.playlists.init();
    for (const playlist of req.event!.playlists)
      await DI.em.removeAndFlush(playlist);
    req.event!.playlists.removeAll();

    await DI.em.flush();
  }

  const tracksWithInfo = playlist.eventTracks
    .getItems()
    .map((eventTrack: EventTrack) => {
      const spotifyTrack = eventTrack.track;
      return {
        id: spotifyTrack.id,
        name: spotifyTrack.trackName,
        duration: spotifyTrack.duration,
        genre: spotifyTrack.genre,
        artist: spotifyTrack.artist,
        artistName: spotifyTrack.artistName,
        albumImage: spotifyTrack.albumImage,
        status: eventTrack.status,
      };
    });

  res.status(200).json(tracksWithInfo);
});

// propose new event track
router.post(
  "/:spotifyTrackId",
  Auth.verifyUnlockedEventParticipantAccess,
  async (req, res) => {
    // check if eventrack already in event
    const eventTrack = await DI.em.findOne(EventTrack, {
      track: { id: req.params.spotifyTrackId },
      event: { id: req.event!.id },
    });
    if (eventTrack)
      return res.status(400).json({ message: "EventTrack already in event." });

    // Find the Event entity
    const event = await DI.em.findOne(Event, { id: req.event!.id });
    if (!event) return res.status(404).json({ error: "Event not found" });

    // Check if spotify track already exists in database
    let track = await DI.em.findOne(SpotifyTrack, req.params.spotifyTrackId);
    if (!track) {
      try {
        // Fetch track information from the Spotify API
        const response = await axios.get(
          `https://api.spotify.com/v1/tracks/${req.params.spotifyTrackId}`,
          {
            headers: {
              Authorization: `Bearer ${req.user!.spotifyAccessToken}`,
            },
          }
        );

        const {
          id,
          duration_ms: duration,
          name: trackName,
          album: { name: genre, images },
          artists,
        } = response.data;

        const artistNames = artists
          .map((artist: any) => artist.name)
          .join(", ");
        const albumImage = images.length > 0 ? images[0].url : "";

        track = new SpotifyTrack(
          id,
          trackName,
          duration,
          genre,
          artists[0].id,
          artistNames,
          albumImage
        );

        await DI.em.persistAndFlush(track);
      } catch (error) {
        console.error(
          "Error fetching track information from Spotify API:",
          error
        );
        return res.status(500).json({ error: "Internal server error" });
      }
    }

    // Create & persist a new event track
    const newEventTrack = new EventTrack(TrackStatus.PROPOSED, track!, event); // Use the found event
    event.eventTracks.add(newEventTrack);

    // Load the playlists collection before adding the event track to it
    await event.playlists.init();
    if (event.playlists.isInitialized()) {
      const playlist = event.playlists.getItems()[0];
      playlist.eventTracks.add(newEventTrack);
      await DI.em.persist(playlist);
    }

    await DI.em.persist(newEventTrack); // Persist the new event track separately
    await DI.em.flush();
    return res.status(201).json(newEventTrack);
  }
);

// Delete a proposed event track from the event playlist
router.delete(
  "/:spotifyTrackId",
  Auth.verifyUnlockedEventParticipantAccess,
  async (req, res) => {
    // Find the Event entity
    const event = await DI.em.findOne(Event, { id: req.event!.id });
    if (!event) return res.status(404).json({ error: "Event not found" });

    // Check if the event track exists in the event
    const eventTrack = await DI.em.findOne(EventTrack, {
      track: { id: req.params.spotifyTrackId },
      event: { id: req.event!.id },
    });
    if (!eventTrack) {
      return res
        .status(404)
        .json({ error: "EventTrack not found in the event" });
    }

    // Initialize the event playlists collection
    await event.playlists.init();

    // Remove the event track from the event playlists
    if (event.playlists.isInitialized()) {
      const playlist = event.playlists.getItems()[0];
      await playlist.eventTracks.init();
      playlist.eventTracks.remove(eventTrack);
      await DI.em.persist(playlist);
    }

    // Remove the event track from the event
    await event.eventTracks.init();
    event.eventTracks.remove(eventTrack);

    // Remove the event track from the database
    await DI.em.persist(eventTrack);
    await DI.em.flush();

    return res
      .status(200)
      .json({ message: "EventTrack removed from the event playlist" });
  }
);

router.post("/save/:spotifyPlaylistId", async (req, res) => {
  const playlist = await DI.em.findOne(Playlist, {
    id: req.params.spotifyPlaylistId,
    event: { id: req.event!.id },
  });
  if (!playlist)
    return res.status(404).json({ message: "Playlist not found." });

  if (!req.user?.spotifyAccessToken)
    return res.status(400).json({ message: "User not logged in." });

  try {
    // Delete all tracks from the playlist
    await deleteAllTracksFromPlaylist(
      req.params.spotifyPlaylistId,
      req.user!.spotifyAccessToken
    );

    // Initialize the event tracks collection
    await playlist.eventTracks.init();
    const eventTracks = playlist.eventTracks.getItems();
    if (eventTracks.length === 0) {
      return res
        .status(400)
        .json({ message: "No accepted tracks in the playlist." });
    }

    const trackUris = eventTracks.map(
      (eventTrack) => `spotify:track:${eventTrack.track.id}`
    );

    if (
      req.user!.spotifyAccessToken === undefined ||
      req.user!.spotifyAccessToken === null
    )
      return res.status(400).json({ message: "User not logged in." });

    // Split trackUris into batches of 100
    const batchSize = 100;
    const trackBatches = [];
    for (let i = 0; i < trackUris.length; i += batchSize)
      trackBatches.push(trackUris.slice(i, i + batchSize));

    // Process each batch and insert tracks
    for (const batchUris of trackBatches) {
      await insertTracksToPlaylist(
        req.params.spotifyPlaylistId,
        req.user!.spotifyAccessToken,
        batchUris
      );
    }

    return res.status(200).json({ message: "Playlist saved successfully." });
  } catch (error) {
    console.error("Error saving the playlist to Spotify:", error);
    return res.status(500).json({ error: "Internal server error." });
  }
});

// Function to delete all tracks from the playlist
const deleteAllTracksFromPlaylist = async (
  playlistId: string,
  accessToken: string
) => {
  try {
    let offset = 0;
    const limit = 100;
    let totalTracks = 1; // Initialize with a non-zero value to enter the loop

    while (offset < totalTracks) {
      const response = await axios.get(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params: {
            offset: offset.toString(),
            limit: limit.toString(),
          },
        }
      );

      const trackUris = response.data.items.map(
        (item: any) => item.track.uri // Assuming the track URI is available under 'track.uri' property
      );

      if (trackUris.length > 0) {
        await axios.delete(
          `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            data: {
              tracks: trackUris.map((uri: string) => ({ uri })),
            },
          }
        );
      }

      totalTracks = response.data.total;
      offset += limit;
    }
  } catch (error) {
    console.error("Error deleting tracks from playlist:", error);
    throw new Error("Failed to delete tracks from the playlist.");
  }
};

const insertTracksToPlaylist = async (
  playlistId: string,
  accessToken: string,
  trackUris: string[]
) => {
  const insertquery = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  try {
    await axios.post(
      insertquery,
      {
        uris: trackUris,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
  } catch (error) {
    console.error("Error adding tracks to playlist:", error);
    throw new Error("Failed to delete tracks from the playlist.");
  }
};

// ================================================================================

// ================================================================================
/*router.get("/", async (req, res) => {
  const eventId = req.event?.id;
  if (!eventId) return res.status(400).json({ error: "Event ID not provided" });

  // Fetch all event tracks for the given event
  const eventTracks = await DI.em.find(
    EventTrack,
    { event: { id: eventId } },
    { populate: ["track"] } // Populating the "track" property of EventTrack with SpotifyTrack entities
  );

  // Map the event tracks to include all the data from the SpotifyTrack entities
  const tracksWithInfo = eventTracks.map((eventTrack) => {
    const spotifyTrack = eventTrack.track;
    return {
      id: spotifyTrack.id,
      name: spotifyTrack.trackName,
      duration: spotifyTrack.duration,
      genre: spotifyTrack.genre,
      artist: spotifyTrack.artist,
      artistName: spotifyTrack.artistName,
      albumImage: spotifyTrack.albumImage,
      status: eventTrack.status,
    };
  });

  res.status(200).json(tracksWithInfo);
});

// change event track status
router.put(
  "/:spotifyTrackId/:status",
  Auth.verifyEventAdminAccess,
  async (req, res) => {
    const eventTrack = await DI.em.findOne(EventTrack, {
      track: { id: req.params.spotifyTrackId },
      event: { id: req.event!.id },
    });
    if (eventTrack) {
      const newTrackStatus =
        TrackStatus[
          req.params.status.toUpperCase() as keyof typeof TrackStatus
        ];
      if (newTrackStatus != undefined) {
        if (
          newTrackStatus == TrackStatus.PROPOSED ||
          newTrackStatus == TrackStatus.GENERATED
        )
          return res
            .status(400)
            .json({ message: "Cannot set status proposed or generated." });
        eventTrack.status = newTrackStatus;
        await DI.em.persistAndFlush(eventTrack);
        return res.status(200).end();
      } else
        res
          .status(400)
          .json({ message: "Failed to cast status to enum type." });
    } else return res.status(404).json({ message: "EventTrack not found." });
  }
);

// accept all tracks from this playlist
router.put(
  "/:spotifyPlaylistId/accept",
  Auth.verifyEventAdminAccess,
  async (req, res) => {
    const playlist = await DI.em.findOne(
      Playlist,
      {
        id: req.params.spotifyPlaylistId,
        event: { id: req.event!.id },
      },
      { populate: ["eventTracks"] }
    );
    if (playlist) {
      for (const track of playlist.eventTracks) {
        if (track.status == TrackStatus.PROPOSED) {
          track.status = TrackStatus.ACCEPTED_PLAYLIST;
          await DI.em.persist(track);
        }
      }
      playlist.accepted = true;
      await DI.em.persistAndFlush(playlist);
      return res.status(200).json(playlist);
    } else return res.status(404).json({ message: "Playlist not found." });
  }
);

// remove playlist & corresponding tracks
router.put(
  "/:spotifyPlaylistId/remove",
  Auth.verifyEventAdminAccess,
  async (req, res) => {
    const removedPlaylist = await removePlaylist(
      req.params.spotifyPlaylistId,
      req.event!.id
    );
    if (removedPlaylist) return res.status(200).end();
    else return res.status(404).json({ message: "Playlist not found." });
  }
);*/

export const TracksController = router;
