import {NextFunction, Request, RequestHandler, Response} from "express";
import {DI} from "../index";
import {User} from "../entities/User";
import {Permission} from "../entities/EventUser";

// prepare check for existing user with valid spotify access_token
const prepareUserAuthentication = async (req: Request, _res: Response, next: NextFunction) => {
    const spotifyToken = req.get('Authorization');
    if (spotifyToken) {
        const user = await DI.em.findOne(User, {spotifyAccessToken: spotifyToken});
        if (user && Date.now() <= user.issuedAt + user.expiresInMs) req.user = user;
        else req.user = null;
    } else req.user = null;
    next();
};

// checks if user is logged in with a valid spotify access_token
const verifySpotifyAccess: RequestHandler = (req, res, next) => {
    if (req.user == null)
        return res.status(401).json({errors: ["verifySpotifyAccess(): You don't have access"]});
    next();
};

// check whether if the user is part of this event
const verifyEventAccess: RequestHandler = (req, res, next) => {
    if(req.eventUser == null)
        return res.status(403).json({errors: ["verifyEventAccess(): You don't have access"]});
    next();
};

const verifyEventParticipantAccess: RequestHandler = async (req, res, next) => {
    if(req.eventUser == null)
        return res.status(403).json({errors: ["verifyParticipantAccess(): You don't have access"]});
    if(castPermissionToInt(req.eventUser.permission.toLowerCase()) < castPermissionToInt(Permission.PARTICIPANT))
        return res.status(403).json({errors: ["verifyParticipantAccess(): You must be at least a participant."]});
    next();
};

// checks if user is at least a participant and event is not locked
const verifyUnlockedEventParticipantAccess: RequestHandler = async (req, res, next) => {
    if (req.eventUser == null || req.event == null)
        return res.status(403).json({errors: ["verifyUnlockedEventParticipantAccess(): Missing event authentication."]});
    if (castPermissionToInt(req.eventUser.permission.toLowerCase()) < castPermissionToInt(Permission.PARTICIPANT))
        return res.status(403).json({errors: ["verifyUnlockedEventParticipantAccess: Insufficient access rights."]});
    if (castPermissionToInt(req.eventUser.permission.toLowerCase()) < castPermissionToInt(Permission.ADMIN) && req.event!.locked)
        return res.status(403).json({errors: ["verifyUnlockedEventParticipantAccess(): Event locked for participant."]});
    next();
};

// checks if user is at least a admin
const verifyEventAdminAccess: RequestHandler = async (req, res, next) => {
    if (req.eventUser == null)
        return res.status(403).json({errors: ["verifyEventAdminAccess: Missing event authentication."]});
    if (castPermissionToInt(req.eventUser.permission.toLowerCase()) < castPermissionToInt(Permission.ADMIN))
        return res.status(403).json({errors: ["verifyEventAdminAccess: Insufficient access rights."]});
    next();
};

const verifyEventOwnerAccess: RequestHandler = async (req: Request, res, next) => {
    if(req.eventUser == null)
        return res.status(403).json({errors: ["verifyOwnerAccess(): You don't have access"]});
    if(castPermissionToInt(req.eventUser.permission.toLowerCase()) < castPermissionToInt(Permission.OWNER))
        return res.status(403).json({errors: ["verifyOwnerAccess(): You must be at least a owner."]});
    next();
};

export const Auth = {
    prepareUserAuthentication,
    verifySpotifyAccess,
    verifyEventAccess,
    verifyEventParticipantAccess,
    verifyUnlockedEventParticipantAccess,
    verifyEventAdminAccess,
    verifyEventOwnerAccess,
};

function castPermissionToInt(permission: string): number {
    switch (permission.toLowerCase()) {
        case "owner": return 4;
        case "admin": return 3;
        case "participant": return 2;
        case "guest": return 1;
        default: return 0;
    }
}