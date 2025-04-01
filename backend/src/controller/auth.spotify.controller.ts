import {Router} from "express";
import * as querystring from "querystring";
import randomstring from "randomstring";
import axios from "axios";
import {DI} from "../index";
import {User} from "../entities/User";
import {Auth} from "../middleware/auth.middleware";

const router = Router({mergeParams: true});

//initiates Spotify Authorisation
router.get('/login', async (req, res) => {
    const state = randomstring.generate(16);
    let scope = ""; // https://developer.spotify.com/documentation/web-api/concepts/scopes
    // backend scopes // TODO: rework scopes and check whats really needed
    scope += " playlist-read-private playlist-read-collaborative playlist-modify-public playlist-modify-private"; // Playlists
    scope += " user-read-playback-position user-top-read user-read-recently-played"; // Listening History
    scope += " user-read-email user-read-private"; // Users // TODO: email and subscription ? needed ?
    // frontend spotify playback scopes
    scope += " user-read-playback-state user-modify-playback-state user-read-currently-playing"; // Spotify connect
    scope += " app-remote-control streaming"; // Playback

    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: DI.spotifyClientId,
            scope: scope,
            redirect_uri: DI.spotifyRedirectUri,
            state: state
        }));
});

// callback from spotify_response, creates/updates user in Database, redirects to frontend
router.get('/login_response', async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;

    if (state === null) res.redirect('/#' + querystring.stringify({error: 'state_mismatch'}));
    else {
        axios.post(
            "https://accounts.spotify.com/api/token",
            {
                code: code,
                redirect_uri: DI.spotifyRedirectUri,
                grant_type: 'authorization_code'
            },
            {
                headers: {
                    'Authorization': 'Basic ' + (Buffer.from(DI.spotifyClientId + ':' + DI.spotifyClientSecret).toString('base64')),
                    "Content-Type": "application/x-www-form-urlencoded",
                }
            }).then((tokenResponse) => {

            axios.get(
                "https://api.spotify.com/v1/me",
                {
                    headers: {
                        Authorization: `Bearer ${tokenResponse.data.access_token}`,
                    },
                }).then(async (userResponse) => {
                let user = await DI.em.findOne(User, userResponse.data.id);
                if (user) {
                    // update user tokens
                    user.spotifyAccessToken = tokenResponse.data.access_token;
                    user.spotifyRefreshToken = tokenResponse.data.refresh_token;
                    user.expiresInMs = tokenResponse.data.expires_in * 1000; // convert to ms
                    user.issuedAt = Date.now(); // unix timestamp in ms
                    await DI.em.persistAndFlush(user);
                    res.redirect(`${DI.frontendUrl}/?access_token=${user.spotifyAccessToken}`);
                } else {
                    // create new user
                    let currentDate = Date.now();
                    user = new User(
                        userResponse.data.id,
                        tokenResponse.data.access_token,
                        tokenResponse.data.refresh_token,
                        tokenResponse.data.expires_in * 1000,
                        currentDate);
                    await DI.em.persistAndFlush(user);
                    res.redirect(`${DI.frontendUrl}/?access_token=${user.spotifyAccessToken}`);
                }
            }).catch(function (error) {
                return res.status(error.status).json(error);
            });
        }).catch(function (error) {
            return res.status(error.status).json(error);
        });
    }
});

// uses the user refresh_token to request a new one and returns it
router.put('/refresh_token', Auth.verifySpotifyAccess, async (req, res) => {
    axios.post(
        'https://accounts.spotify.com/api/token',
        {
            grant_type: 'refresh_token',
            refresh_token: req.user!.spotifyRefreshToken
        },
        {
            headers: {
                'Authorization': 'Basic ' + (Buffer.from(DI.spotifyClientId + ':' + DI.spotifyClientSecret).toString('base64')),
                "Content-Type": "application/x-www-form-urlencoded",
            },
        }).then((tokenResponse) => {
        req.user!.spotifyAccessToken = tokenResponse.data.access_token;
        req.user!.expiresInMs = tokenResponse.data.expires_in * 1000;
        req.user!.issuedAt = Date.now();
        DI.em.persistAndFlush(req.user!);
        return res.status(200).json(req.user);
    }).catch(function (error) {
        console.error(error);
        return res.status(error.status).json(error);
    });
});
// returns spotify user ID
router.get('/spotifyUserId', Auth.verifySpotifyAccess, async (req, res) => {
    return res.status(200).json({spotifyUserId: req.user!.spotifyId});
});

// returns how long the current access_token is still valid
router.get('/remaining_expiry_time', Auth.verifySpotifyAccess, async (req, res) => {
    const remainingTime = req.user!.expiresInMs - (Date.now() - req.user!.issuedAt);
    return res.status(200).json({expires_in: remainingTime});
});

// resets the access- & refresh_token server side, token is not invalidated !
router.put('/logout', Auth.verifySpotifyAccess, async (req, res) => {
    await DI.em.persistAndFlush(req.user!);
    return res.status(204).end();
});

export const SpotifyAuthController = router;