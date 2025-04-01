import {Router} from "express";
import {Event} from "../entities/Event";
import {User} from "../entities/User";
import {EventUser, Permission} from "../entities/EventUser";
import {SpotifyTrack} from "../entities/SpotifyTrack";
import {EventTrack, TrackStatus} from "../entities/EventTrack";
import {Playlist} from "../entities/Playlist";
import {DI} from "../index";
import axios from "axios";

const AMOUNT_ARTISTS = 20;
const AMOUNT_TRACKS_PER_ARTIST = 3;
const AMOUNT_RECOMMENDATIONS = 50;
const PLAYLIST_SIZE = 100;

class Artist {
    id: string;
    highestWeight: number;
    genres: Array<string>;

    constructor(id: string, startWeight: number, genres: Array<string>) {
        this.id = id;
        this.highestWeight = startWeight;
        this.genres = genres;
    }
}

interface SongPlaylist {
    id: string;
    name: string;
    href: string;
}

const router = Router({mergeParams: true});


router.put("/generate", async (req, res) => {
    // TODO: lock event
    req.event = await DI.em.findOne(Event, {id: req.event!.id});
    if (!req.event) return res.status(404).json({message: "Event not found."});

    // Clear before new run
    await req.event!.eventTracks.init();
    for (const eventTrack of req.event!.eventTracks) await DI.em.removeAndFlush(eventTrack);
    req.event!.eventTracks.removeAll();

    await req.event!.playlists.init();
    for (const playlist of req.event!.playlists) await DI.em.removeAndFlush(playlist);
    req.event!.playlists.removeAll();

    await DI.em.flush();

    // Check and regenerate access tokens
    let eventUserOwner = await DI.em.findOne(
        EventUser,
        {
            event: {id: req.event!.id},
            permission: Permission.OWNER,
        },
        {
            populate: ["user"],
        }
    );
    if (!eventUserOwner) return res.status(404).json({message: "Owner not found."});
    eventUserOwner.user.spotifyAccessToken = await generateAccessToken(eventUserOwner.user);
    const owner = eventUserOwner.user;
    if (!owner.spotifyAccessToken) return res.status(404).json({message: "Owner access token not found."});
    let access_token_array = new Array<string>();
    access_token_array.push(owner.spotifyAccessToken);
    const eventUsers = await DI.em.find(
        EventUser,
        {
            event: {id: req.event!.id},
        },
        {
            populate: ["user"],
        }
    );
    for (const eventUser of eventUsers)
        if (eventUser.user != owner)
            access_token_array.push(await generateAccessToken(eventUser.user));


    const maxSongsPerUser = Math.floor((PLAYLIST_SIZE - 50) / access_token_array.length);

    if (access_token_array[0] == null)
        return res
            .status(500)
            .json({message: "Server failed to generate new token for owner"});

    console.log(
        "0: Generating playlist for event " +
        req.event!.id +
        " from owner " +
        eventUserOwner.user.spotifyId +
        " with " +
        access_token_array.length +
        " users"
    );

    // START GENERATING PLAYLIST
    // ====================================================================================================
    // 1. All users:
    // Find common songs between all playlists of users and add them to the playlist
    // ====================================================================================================
    await findCommonSongsBetweenPlaylists(
        req.event!,
        access_token_array,
        maxSongsPerUser
    );

    // ====================================================================================================
    // 2. Each user:
    // Find top artists of each user and add their top tracks to the playlist
    // ====================================================================================================
    await addTopTracksForEachUser(
        req.event!,
        access_token_array,
        maxSongsPerUser
    );

    // ====================================================================================================
    // 3. All users:
    // Find common genres between users and add recommendations to the playlist (if playlist less than 200 songs)
    // ====================================================================================================
    while (req.event!.eventTracks.length < PLAYLIST_SIZE) {
        const recommendations = await addCommonGenresRecommendations(
            req.event!,
            access_token_array
        );
        if (recommendations == 0) {
            console.log("No more recommendations found.");
            break;
        }
    }

    // ====================================================================================================
    // 4. Create Spotify playlist from event
    // ====================================================================================================
    const playlistID = await createSpotifyPlaylistFromEvent(req.event!, owner);
    if (playlistID == "undefined")
        return res
            .status(500)
            .json({message: "Server failed to create playlist."});

    return res
        .status(200)
        .json({
            message: "Successfully created playlist!",
            playlistID: playlistID,
            newOwnerToken: access_token_array[0],
        })
        .end();
});

// ====================================================================================================
function generateAccessToken(user: User): Promise<string> {
    return axios
        .post(
            "https://accounts.spotify.com/api/token",
            {
                grant_type: "refresh_token",
                refresh_token: user.spotifyRefreshToken,
            },
            {
                headers: {
                    Authorization:
                        "Basic " +
                        Buffer.from(
                            DI.spotifyClientId + ":" + DI.spotifyClientSecret
                        ).toString("base64"),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        )
        .then((tokenResponse) => {
            return tokenResponse.data.access_token;
        })
        .catch((error) => {
            console.log("generateAccessToken() " + error.message);
            return "undefined";
        });
}

// ====================================================================================================

async function findCommonSongsBetweenPlaylists(
    event: Event,
    accessTokens: string[],
    maxSongsPerUser: number
) {
    // Data structure to store common song IDs
    let commonSongIds: Set<string> | null = null;

    // Iterate through each user's playlist and find common song IDs
    for (const access_token of accessTokens) {
        if (access_token == null) continue;

        const userPlaylists = await fetchUserPlaylists(access_token);
        if (userPlaylists && userPlaylists.items) {
            const playlistSongIds = new Set<string>();

            for (const playlist of userPlaylists.items) {
                const playlistTracks = await fetchPlaylistTracks(
                    access_token,
                    playlist.id
                );
                if (playlistTracks && playlistTracks.items) {
                    for (const track of playlistTracks.items) {
                        playlistSongIds.add(track.track.id);
                    }
                }
            }

            if (commonSongIds === null) commonSongIds = playlistSongIds;
            else {
                commonSongIds = new Set<string>(
                    [...commonSongIds].filter((songId: string) =>
                        playlistSongIds.has(songId)
                    )
                );
            }
        }
    }

    if (commonSongIds && commonSongIds.size > 0) {
        // console.log("1: Common songs between all users: " + util.inspect(commonSongIds, false, null, true));
        console.log("1: Common songs between all users: " + commonSongIds.size);
        const tracksToAdd: string[] = [];
        for (const songId of commonSongIds) {
            if (tracksToAdd.length >= maxSongsPerUser * accessTokens.length) break; // Check if the song amount limit is reached
            tracksToAdd.push(songId);
        }
        for (const songId of tracksToAdd) await addTrackToEvent(event, accessTokens, songId);
    } else console.log("findCommonSongsBetweenPlaylists(): No common songs found between all users.");
}

async function fetchUserPlaylists(
    access_token: string
): Promise<{ items: SongPlaylist[] } | null> {
    const response = await axios
        .get("https://api.spotify.com/v1/me/playlists", {
            headers: {
                Authorization: "Bearer " + access_token,
            },
        })
        .then((response) => {
            return response.data;
        })
        .catch((error) => {
            console.log("fetchUserPlaylists() " + error.message);
            return null;
        });
    return response;
}

async function fetchPlaylistTracks(
    access_token: string,
    playlistId: string
): Promise<{ items: { track: { id: string } }[] } | null> {
    const response = await axios
        .get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
            headers: {
                Authorization: "Bearer " + access_token,
            },
        })
        .then((response) => {
            return response.data;
        })
        .catch((error) => {
            console.log("fetchPlaylistTracks() " + error.message);
            return null;
        });
    return response;
}

// ====================================================================================================

async function addTopTracksForEachUser(
    event: Event,
    accessTokens: string[],
    maxSongsPerUser: number
) {
    // Step 1: Fetch top artists for all users concurrently
    const topArtistsArray: string[][] = await Promise.all(
        accessTokens.map(async (access_token) => {
            if (access_token == null) return [];

            const response = await axios.get(
                `https://api.spotify.com/v1/me/top/artists?limit=${AMOUNT_ARTISTS}`,
                {
                    headers: {
                        Authorization: "Bearer " + access_token,
                    },
                }
            );

            const topArtists: string[] = response.data.items.map(
                (artist: Artist) => artist.id
            );
            return topArtists;
        })
    );

    // Step 2: Collect the top artists for each user in an array for comparison
    const allTopArtists: string[] = topArtistsArray.reduce(
        (commonArtists, topArtists) => {
            return commonArtists.filter((artist) => topArtists.includes(artist));
        }
    );

    // Step 3: Find the common top artists among all users
    const commonTopArtists: Set<string> = new Set(allTopArtists);

    // Step 4: Get the top tracks for the common top artists
    const commonTopTracks: string[] = [];
    for (const artistId of commonTopArtists) {
        const topTrackIds = await fetchArtistTopTrackIds(accessTokens[0], artistId);
        if (topTrackIds) {
            for (const trackId of topTrackIds) {
                if (commonTopTracks.length >= maxSongsPerUser * accessTokens.length) break; // Check if the limit is reached
                commonTopTracks.push(trackId);
            }
        }
    }

    //console.log("2: Common top tracks: " + util.inspect(commonTopTracks, false, null, true));
    console.log("2: Common top tracks: " + commonTopTracks.length);

    // Step 5: Add the common top tracks to the event playlist
    for (const trackId of commonTopTracks) await addTrackToEvent(event, accessTokens, trackId);
}

async function fetchArtistTopTrackIds(
    access_token: string,
    artistId: string
): Promise<string[] | null> {
    const response = await axios
        .get(
            `https://api.spotify.com/v1/artists/${artistId}/top-tracks?country=DE&limit=${AMOUNT_TRACKS_PER_ARTIST}`,
            {
                headers: {
                    Authorization: "Bearer " + access_token,
                },
            }
        )
        .then((response) => {
            const topTracks = response.data.tracks;
            return topTracks.map((track: any) => track.id);
        })
        .catch((error) => {
            console.log("fetchArtistTopTracks() " + error.message);
            return null;
        });
    return response;
}

// ====================================================================================================

async function addCommonGenresRecommendations(
    event: Event,
    accessTokens: string[]
): Promise<number> {
    // Data structure to store common genres
    const commonGenres = new Map<string, number>();

    let availableGenres: Set<string> = new Set();
    await axios
        .get("https://api.spotify.com/v1/recommendations/available-genre-seeds", {
            headers: {
                Authorization: "Bearer " + accessTokens[0],
            },
        })
        .then((response) => {
            if (response.data && response.data.genres)
                availableGenres = new Set(response.data.genres);
        })
        .catch((error) => {
            console.log("addCommonGenresRecommendations() " + error.message);
        });

    // Collect user genres and find the common genres
    for (const access_token of accessTokens) {
        if (access_token == null) continue;

        await axios
            .get(`https://api.spotify.com/v1/me/top/artists?limit=50`, {
                headers: {
                    Authorization: "Bearer " + access_token,
                },
            })
            .then(async (response) => {
                if (response.data && response.data.items) {
                    // Check if response.data and response.data.items exist
                    for (const artist of response.data.items) {
                        if (artist.genres) {
                            artist.genres.forEach((genre: string) => {
                                if (availableGenres.has(genre))
                                    if (commonGenres.has(genre))
                                        commonGenres.set(genre, commonGenres.get(genre)! + 1);
                                    else commonGenres.set(genre, 1);
                            });
                        }
                    }
                }
            })
            .catch((error) => {
                console.log("fetchUserArtists() " + error.message);
            });
    }

    // Filter genres to get the most common ones up to a maximum of 5
    const sortedGenres = Array.from(commonGenres.entries()).sort(
        (a, b) => b[1] - a[1]
    );
    const filteredGenres = sortedGenres.slice(0, 5).map((entry) => entry[0]);

    // Add recommendations based on common genres
    if (filteredGenres.length > 0) {
        const formattedGenres = filteredGenres.map((genre) =>
            genre.replace(/\s+/g, "+")
        );

        const recommendations = await getRecommendationsByGenres(
            accessTokens[0],
            formattedGenres
        );

        // console.log("3: Got " + util.inspect(recommendations, false, null, true));
        console.log("3: Got " + recommendations?.length + " recommendations.");
        if (recommendations == null) return 0;
        for (const track of recommendations)
            await addTrackToEvent(event, accessTokens, track.id);
        return recommendations.length;
    }
    return 0;
}

async function getRecommendationsByGenres(
    access_token: string,
    genres: string[]
): Promise<
    { id: string; duration_ms: number; artists: { name: string }[] }[] | null
> {
    const query =
        "https://api.spotify.com/v1/recommendations" +
        "?seed_genres=" +
        genres.join("%2C") +
        "&limit=" +
        AMOUNT_RECOMMENDATIONS;

    return axios
        .get(query, {
            headers: {
                Authorization: "Bearer " + access_token,
            },
        })
        .then((response) => {
            const tracks = response.data.tracks;
            const returnTracks = tracks.map((track: any) => ({
                id: track.id,
                duration_ms: track.duration_ms,
                artists: track.artists,
            }));

            return returnTracks;
        })
        .catch((error) => {
            console.log("getRecommendationsByGenres() " + error.message);
            return null;
        });
}

// ====================================================================================================
async function createSpotifyPlaylistFromEvent(
    event: Event,
    owner: User
): Promise<string> {
    console.log(
        "4: Creating Playlist for Event " +
        event.id +
        " from owner " +
        owner.spotifyId +
        " with " +
        event.eventTracks.length +
        " tracks "
    );

    await event.eventTracks.init();
    const eventTracksArray: EventTrack[] = [...event.eventTracks];

    console.log("Trying to create playlist for owner " + owner.spotifyId);
    console.log("Trying to create playlist for owner with access token " + owner.spotifyAccessToken);
    return axios
        .post(
            "https://api.spotify.com/v1/users/" + owner.spotifyId + "/playlists",
            {
                name: event.name,
                description: "Automatically generated by FWE Spotify App.",
                public: true,
            },
            {
                headers: {
                    Authorization: "Bearer " + owner.spotifyAccessToken,
                },
            }
        )
        .then(async function (response) {
            const playlistId: string = response.data.id;
            if (!playlistId) return "undefined";
            const newPlaylist: Playlist = new Playlist(playlistId);
            newPlaylist.accepted = false;
            event.playlists.add(newPlaylist);
            const uniqueEventTracks: EventTrack[] = await returnUniqueEventTracks(
                eventTracksArray
            );
            let batch: string[] = [];
            for (const batchTrack of uniqueEventTracks) {
                if (
                    batchTrack.status == TrackStatus.GENERATED ||
                    batchTrack.status == TrackStatus.ACCEPTED_PLAYLIST ||
                    batchTrack.status == TrackStatus.ACCEPTED
                ) {
                    const trackId: string = batchTrack.track.id;
                    const trackUri: string = "spotify:track:" + trackId;

                    // Add the track to the batch for playlist creation
                    batchTrack.playlists.add(newPlaylist);
                    batch.push(trackUri);
                }

                if (batch.length >= 25) {
                    await pushTracksToSpotifyPlaylist(owner, playlistId, batch);
                    batch = []; // Clear the batch after each function call
                }

                const checkTrack = await DI.em.findOne(EventTrack, {
                    event: {id: event.id},
                    track: {id: batchTrack.track.id},
                });
                if (!checkTrack) await DI.em.persistAndFlush(batchTrack);
            }

            if (batch.length > 0) {
                await pushTracksToSpotifyPlaylist(owner, playlistId, batch);
            }

            return playlistId;
        })
        .catch(function (error) {
            console.log("createSpotifyPlaylistFromEvent() " + error.message);
            return "undefined";
        });
}

async function returnUniqueEventTracks(
    eventTracksArray: EventTrack[]
): Promise<EventTrack[]> {
    const processedTrackIds = new Set<string>();

    // Filter out duplicates from the eventTracks array
    const uniqueEventTracks: EventTrack[] = eventTracksArray.filter(
        (batchTrack) => {
            const trackId = batchTrack.track.id;
            if (processedTrackIds.has(trackId)) {
                console.log("Duplicate track found and removed: Track ID: " + trackId);
                return false; // Skip this track, as it's a duplicate
            }
            processedTrackIds.add(trackId);
            return true; // Include this track, as it's unique
        }
    );

    return uniqueEventTracks;
}

async function pushTracksToSpotifyPlaylist(
    owner: User,
    playlistId: string,
    trackBatch: Array<string>
) {
    const query =
        "https://api.spotify.com/v1/playlists/" + playlistId + "/tracks";

    axios
        .post(
            query,
            {
                uris: trackBatch,
            },
            {
                headers: {
                    Authorization: "Bearer " + owner.spotifyAccessToken,
                },
            }
        )
        .then(function (response) {
            //console.log("Tracks successfully added to the playlist.");
        })
        .catch(function (error) {
            console.log("pushTracksToSpotifyPlaylist() " + error.message);
        });
}

// ====================================================================================================

async function addTrackToEvent(
    event: Event,
    accessTokens: string[],
    trackId: string
) {
    const existingEventTrack = await DI.em.findOne(EventTrack, {
        event: {id: event.id},
        track: {id: trackId},
    });

    // If track already exists, update its status if needed
    if (existingEventTrack) {
        if (
            existingEventTrack.status !== TrackStatus.DENIED &&
            existingEventTrack.status < TrackStatus.GENERATED
        ) {
            existingEventTrack.status = TrackStatus.GENERATED;
            await DI.em.persist(existingEventTrack);
        }
        return;
    }

    // check if track exists
    let topTrack = await DI.em.findOne(SpotifyTrack, {
        id: trackId,
    });

    // else create new track
    if (!topTrack) {
        await axios
            .get(`https://api.spotify.com/v1/tracks/${trackId}`, {
                headers: {
                    Authorization: "Bearer " + accessTokens[0],
                },
            })
            .then(async (response) => {
                const genreString = await getGenreString(
                    response.data.artists[0].id,
                    accessTokens[0]
                );
                topTrack = new SpotifyTrack(
                    response.data.id,
                    response.data.name,
                    response.data.duration_ms,
                    genreString,
                    response.data.artists[0].id,
                    response.data.artists[0].name,
                    response.data.album.images[0]?.url || ""
                );
                const checkTrack = await DI.em.findOne(SpotifyTrack, {
                    id: topTrack!.id,
                });
                if (!checkTrack) await DI.em.persist(topTrack);
            })
            .catch((error) => {
                console.log("addTrackToEvent() " + error.message);
            });
    }
    if (topTrack) {
        // check if event track exists
        let trackInEvent = await DI.em.findOne(EventTrack, {
            event: {id: event.id},
            track: {id: topTrack.id},
        });

        if (!trackInEvent) {
            let insertEventTrack = new EventTrack(
                TrackStatus.GENERATED,
                topTrack,
                event
            );
            event.eventTracks.add(insertEventTrack);
        } else {
            if (
                trackInEvent.status != TrackStatus.DENIED &&
                trackInEvent.status < TrackStatus.GENERATED
            )
                trackInEvent.status = TrackStatus.GENERATED;
        }
    }
}

async function getGenreString(artistId: string, access_token: string) {
    return await axios
        .get(`https://api.spotify.com/v1/artists/${artistId}`, {
            headers: {
                Authorization: "Bearer " + access_token,
            },
        })
        .then((response) => {
            return response.data.genres && response.data.genres.length > 0
                ? response.data.genres.join(",")
                : "Unknown";
        })
        .catch((error) => {
            console.log("getGenreString() " + error.message);
            return "Unknown";
        });
}

export const EventAlgorithmController = router;
