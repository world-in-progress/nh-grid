import { Callback } from '../types'

export function checkIfReady(_: unknown, callback: Callback<any>) {

    callback()
}

export function hello(_: unknown, __: Callback<any>) {
    
    console.log('Hello!')
}
