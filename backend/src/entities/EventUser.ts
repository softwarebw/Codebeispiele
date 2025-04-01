import {Entity, ManyToOne, Property} from "@mikro-orm/core";
import {User} from './User'
import {Event} from './Event'

// hierarchical order, top to bottom, every level has all rights of all levels above
export enum Permission {
    PARTICIPANT = "participant",
    ADMIN = "admin",
    OWNER = "owner",
}

@Entity()
export class EventUser {

    @ManyToOne({entity: () => Event, primary: true, onDelete: 'cascade'})
    event!: Event;

    @ManyToOne({entity: () => User, primary: true})
    user!: User;

    @Property()
    permission!: Permission;

    constructor(permission: Permission, user: User, event: Event) {
        this.permission = permission;
        this.user = user;
        this.event = event;
    }
}
