import express, { Router } from "express";
import { DI } from "../index";
import { EventUser, Permission } from "../entities/EventUser";
import { Auth } from "../middleware/auth.middleware";

const router = Router({ mergeParams: true });

// fetch event participants
router.get("/", async (req, res) => {
  const allUsers = await DI.em.find(
    EventUser,
    {
      event: { id: req.event!.id },
    },
    {
      populate: ["user"],
    }
  );
  if (allUsers) return res.status(200).json({ allUsers: allUsers });
  else return res.status(400).json({ message: "Did not find EventUsers" });
});

// kick user out of event
router.put(
  "/:spotifyUserId",
  Auth.verifyEventAdminAccess,
  async (
    req: express.Request<{
      eventId: string;
      spotifyUserId: string;
    }>,
    res
  ) => {
    const targetUser = await DI.em.findOne(EventUser, {
      user: { spotifyId: req.params.spotifyUserId },
      event: { id: req.params.eventId },
    });
    if (targetUser) {
      if (targetUser.permission == Permission.OWNER)
        return res.status(400).json({ message: "Owner cant be kicked." });
      if (
        targetUser.permission == Permission.ADMIN &&
        req.eventUser!.permission == Permission.ADMIN
      )
        return res
          .status(403)
          .json({ message: "Admins cant kick other admins." });
      await DI.em.removeAndFlush(targetUser);
      return res.status(204).json({ message: "User successfully removed." });
    } else
      return res
        .status(404)
        .json({ message: "The target user was not found." });
  }
);

// change user permissions
router.put(
  "/:spotifyUserId/:permissions",
  Auth.verifyEventAdminAccess,
  async (
    req: express.Request<{
      eventId: string;
      spotifyUserId: string;
      permissions: Permission;
    }>,
    res
  ) => {
    const requestingUser = req.eventUser!;
    const targetUser = await DI.em.findOne(EventUser, {
      user: { spotifyId: req.params.spotifyUserId },
      event: { id: req.params.eventId },
    });
    if (targetUser) {
      if (targetUser.permission == Permission.OWNER)
        return res.status(400).json({ message: "Owner cant be modified." });
      if (
        targetUser.permission == Permission.ADMIN &&
        requestingUser.permission == Permission.ADMIN
      )
        return res
          .status(403)
          .json({ message: "Admins cant be updated by other Admins." });
      const newPermissions =
        Permission[
          req.params.permissions.toUpperCase() as keyof typeof Permission
        ];
      if (newPermissions != undefined) {
        targetUser.permission = req.params.permissions;
        await DI.em.persistAndFlush(targetUser);
        return res.status(204).json({ message: "User successfully updated." });
      } else
        res
          .status(400)
          .json({ message: "Failed to cast status to enum type." });
    } else
      return res
        .status(404)
        .json({ message: "The target user was not found." });
  }
);

export const EventParticipantsController = router;
