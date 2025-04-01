import {Options} from '@mikro-orm/core';
import {User} from './entities/User';

const options: Options = {
    type: 'postgresql',
    entities: [User],
    dbName: 'diaryDB',
    password: 'fweSS22',
    user: 'diaryDBUser',
    debug: true,
};

export default options;
