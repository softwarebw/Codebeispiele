import {User} from "../entities/User";
import {EventUser} from "../entities/EventUser";
import {Event} from "../entities/Event";

declare global {
    namespace Express {
        interface Request {
            user: User | null,
            eventUser: EventUser | null,
            event: Event | null,
        }
    }
}