import { Router } from "express";
import { DI } from "../index";
import { Event } from "../entities/Event";
import randomstring from "randomstring";
import {
  EVENT_ID_LENGTH,
  MAX_EVENT_ID_GENERATION_RETRIES,
} from "./event.controller";
import { EventUser } from "../entities/EventUser";

const router = Router({ mergeParams: true });

router.put("/generateNewId", async (req, res) => {
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

  req.event!.id = newEventId;
  await DI.em.persistAndFlush(req.event!);
  return res.status(200).end();
});

router.put("/id/:newId", async (req, res) => {
  const newEventId = req.params.newId;
  const newEventName = req.body.newName;
  const newEventDate = req.body.newDate;

  if (newEventId.length !== EVENT_ID_LENGTH) {
    return res
      .status(400)
      .send({ message: "Id is not " + EVENT_ID_LENGTH + " long." });
  }

  const existingEvent = await DI.em.findOne(Event, { id: newEventId });
  if (existingEvent) {
    return res
      .status(400)
      .json({ message: "Another event already uses this id." });
  }

  // Create a new Event entity with the updated ID, name, and date
  const newEvent = new Event(newEventId, newEventName, newEventDate);
  await DI.em.persistAndFlush(newEvent);

  // Fetch the existing EventUser instances related to the current event ID
  const eventUsers = await DI.em.find(EventUser, { event: req.event });

  // Update the EventUser instances with the new event ID
  for (const eventUser of eventUsers) {
    eventUser.event = newEvent;
    await DI.em.persistAndFlush(eventUser);
  }

  const eventTracks = await DI.em.find(EventUser, { event: req.event });
  for (const eventTrack of eventTracks) {
    eventTrack.event = newEvent;
    await DI.em.persistAndFlush(eventTrack);
  }

  // Remove the old Event entity from the database
  await DI.em.removeAndFlush(req.event!);

  return res.status(200).end();
});

//change event name
router.put("/name/:newName", async (req, res) => {
  req.event!.name = req.params.newName;
  await DI.em.persistAndFlush(req.event!);
  return res.status(200).end();
});

// change event date
router.put("/date/:newDate", async (req, res) => {
  // cast string to Date
  let timestamp = Date.parse(req.params.newDate);
  if (isNaN(timestamp))
    return res
      .status(400)
      .json({ message: "Provided string is not a valid date." });

  // update date
  req.event!.date = new Date(timestamp);
  await DI.em.persistAndFlush(req.event!);
  return res.status(200).end();
});

// close event for new entries
router.put("/lock", async (req, res) => {
  req.event!.locked = true;
  await DI.em.persistAndFlush(req.event!);
  return res.status(200).end();
});

// open event for new entries
router.put("/unlock", async (req, res) => {
  req.event!.locked = false;
  await DI.em.persistAndFlush(req.event!);
  return res.status(200).end();
});

export const EventSettingsController = router;
