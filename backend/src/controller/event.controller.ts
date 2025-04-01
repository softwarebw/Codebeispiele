import { Router } from "express";
import randomstring from "randomstring";
import { DI } from "../index";
import { EventUser, Permission } from "../entities/EventUser";
import { Event } from "../entities/Event";
import { Auth } from "../middleware/auth.middleware";
import { EventSettingsController } from "./event.settings.controller";
import { EventParticipantsController } from "./event.participants.controller";
import { TracksController } from "./event.tracks.controller";
import { EventAlgorithmController } from "./event.algorithm.controller";
import { EventTrack } from "../entities/EventTrack";
import util from "util";
import { Playlist } from "../entities/Playlist";

export const EVENT_ID_LENGTH: number = 6;
export const MAX_EVENT_ID_GENERATION_RETRIES: number = 1000;

const router = Router({ mergeParams: true });

// prepare to check requested event
// (was planned to be part of the auth.middleware.ts but was missing access to the eventId param)
router.param("eventId", async function (req, res, next, eventId) {
  const eventUser = await DI.em.findOne(EventUser, {
    event: { id: eventId },
    user: { spotifyAccessToken: req.user!.spotifyAccessToken },
  });
  if (eventUser) {
    req.eventUser = eventUser;
    req.event = eventUser.event;
  } else {
    req.eventUser = null;
    req.event = null;
  }
  next();
});

router.use("/:eventId/tracks", Auth.verifyEventAccess, TracksController);
router.use("/:eventId/participants", EventParticipantsController);
router.use(
  "/:eventId/settings",
  Auth.verifyEventOwnerAccess,
  EventSettingsController
);
router.use(
  "/:eventId/algorithm",
  Auth.verifyEventOwnerAccess,
  EventAlgorithmController
);

// fetch all events of user
router.get("/", async (req, res) => {
  const events = await DI.em.find(Event, { users: { user: req.user } });
  return res.status(200).json(events);
});

// create a new event
router.post("/", async (req, res) => {
  // generate random string as eventId
  let newEventId;
  let event = null;
  let retries = 0;
  do {
    retries++;
    newEventId = randomstring.generate(EVENT_ID_LENGTH);
    event = await DI.em.findOne(Event, { id: newEventId });
  } while (event != null || retries >= MAX_EVENT_ID_GENERATION_RETRIES);

  // Failed to generate unique id, return internal server error
  if (retries >= MAX_EVENT_ID_GENERATION_RETRIES && event != null)
    res.status(500).end();

  // create event & add user as owner
  event = new Event(newEventId, req.body.name, req.body.date);
  const eventUser = new EventUser(Permission.OWNER, req.user!, event);
  await DI.em.persist(event).persist(eventUser).flush();
  res.status(201).json(event);
});

// fetch all data from one event
router.get("/:eventId", async (req, res) => {
  const event = await DI.em.findOne(Event, { id: req.params.eventId });
  if (event) {
    // check if user is already in event
    req.eventUser = await DI.em.findOne(EventUser, {
      user: req.user,
      event: event,
    });
    // add user if not already existing
    if (req.eventUser == null) {
      try {
        const newUser = new EventUser(Permission.PARTICIPANT, req.user!, event);
        await DI.em.persistAndFlush(newUser);
        return res.status(200).json(event);
      } catch (error) {
        return res.status(500).send("Error joining event");
      }
    }
    return res.status(200).send("User is already in event");
  } else return res.status(404).send("Event not found");
});

// leave event (except owner)
router.put("/:eventId", Auth.verifyEventAccess, async (req, res) => {
  if (req.eventUser!.permission == Permission.OWNER)
    return res
      .status(400)
      .json({ message: "Owner cant leave event, delete event instead." });
  await DI.em.removeAndFlush(req.eventUser!);
  res.status(200).end();
});

// delete one event
router.delete("/:eventId", Auth.verifyEventOwnerAccess, async (req, res) => {
  const event = await DI.em.findOne(Event, { id: req.params.eventId });
  const eventTracks = await DI.em.find(EventTrack, { event: event });
  for (const eventTrack of eventTracks) await DI.em.removeAndFlush(eventTrack);

  const eventUsers = await DI.em.find(EventUser, { event: event });
  for (const eventUser of eventUsers) await DI.em.removeAndFlush(eventUser);
  const eventPlaylists = await DI.em.find(Playlist, { event: event });

  for (const eventPlaylist of eventPlaylists) await DI.em.removeAndFlush(eventPlaylist);
  
  if (event) {
    await DI.em.removeAndFlush(event);
    return res.status(200).end();
  } else return res.status(404).json({ message: "Event not found." });
});

export const EventController = router;
